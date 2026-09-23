import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ApiErrorCode, AppointmentStatus, AppointmentType, UserRole } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { AppException } from "../common/errors/app-exception";
import { SAFE_USER_SELECT } from "../common/prisma/safe-user-select";
import { PaginatedResult } from "../common/pagination/paginated-result";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { AvailabilityService } from "../doctors/availability.service";
import { AppointmentReminderQueueService } from "../queue/appointment-reminder-queue.service";
import type { BookAppointmentDto } from "./dto/book-appointment.dto";
import type { CreateEmergencyAppointmentDto } from "./dto/create-emergency-appointment.dto";
import type { UpdateAppointmentStatusDto } from "./dto/update-appointment-status.dto";
import type { FindAppointmentsQueryDto } from "./dto/find-appointments-query.dto";

const APPOINTMENT_INCLUDE = {
  doctor: { include: { user: { select: SAFE_USER_SELECT } } },
  patient: { include: { user: { select: SAFE_USER_SELECT } } },
} as const;

/**
 * FR-APPT-005 state machine, restricted per docs/07-RBAC-MATRIX.md §3.3's
 * "Update appointment status" row. Read as: `role -> fromStatus -> allowed
 * target statuses`. `PENDING` is never a target (nothing transitions back
 * into it); `COMPLETED`/`CANCELLED`/`NO_SHOW` are terminal — absent as a
 * `from` key anywhere below. NURSE is deliberately limited to the single
 * "check-in" transition per the matrix's "check-in only" note; PATIENT is
 * limited to cancelling their own still-`PENDING` request per the matrix's
 * "cancel own, pending only" note — a PATIENT cannot cancel an already
 * `CONFIRMED` appointment themselves (documented interpretation,
 * docs/11-DECISIONS.md, since the matrix states this restriction but the
 * requirement text doesn't elaborate further).
 */
const ALLOWED_TRANSITIONS: Record<UserRole, Partial<Record<AppointmentStatus, AppointmentStatus[]>>> = {
  [UserRole.HOSPITAL_ADMIN]: {
    [AppointmentStatus.PENDING]: [AppointmentStatus.CONFIRMED, AppointmentStatus.CANCELLED],
    [AppointmentStatus.CONFIRMED]: [
      AppointmentStatus.IN_PROGRESS,
      AppointmentStatus.CANCELLED,
      AppointmentStatus.NO_SHOW,
    ],
    [AppointmentStatus.IN_PROGRESS]: [AppointmentStatus.COMPLETED],
  },
  [UserRole.DOCTOR]: {
    [AppointmentStatus.PENDING]: [AppointmentStatus.CONFIRMED],
    [AppointmentStatus.CONFIRMED]: [AppointmentStatus.IN_PROGRESS, AppointmentStatus.NO_SHOW],
    [AppointmentStatus.IN_PROGRESS]: [AppointmentStatus.COMPLETED],
  },
  [UserRole.NURSE]: {
    [AppointmentStatus.CONFIRMED]: [AppointmentStatus.IN_PROGRESS],
  },
  [UserRole.RECEPTIONIST]: {
    [AppointmentStatus.PENDING]: [AppointmentStatus.CONFIRMED, AppointmentStatus.CANCELLED],
    [AppointmentStatus.CONFIRMED]: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW],
  },
  [UserRole.PATIENT]: {
    [AppointmentStatus.PENDING]: [AppointmentStatus.CANCELLED],
  },
  [UserRole.SUPER_ADMIN]: {},
  [UserRole.LAB_TECHNICIAN]: {},
  [UserRole.PHARMACIST]: {},
  [UserRole.ACCOUNTANT]: {},
};

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly availabilityService: AvailabilityService,
    private readonly reminderQueue: AppointmentReminderQueueService,
  ) {}

  /** Reminder scheduling/cancellation is a side effect of a status change
   * that has ALREADY committed to the database by the time this runs — a
   * BullMQ failure here (e.g. a malformed job id) must never surface as a
   * failed request when the actual status transition succeeded. Found live
   * during Phase 5 testing: a PENDING→CONFIRMED transition persisted
   * correctly but the client received a 500 because job scheduling threw
   * afterward, leaving the client believing the transition never happened. */
  private async safeReminderCall(action: () => Promise<void>, context: string): Promise<void> {
    try {
      await action();
    } catch (err) {
      this.logger.error(`Reminder ${context} failed (non-fatal, appointment update already committed): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async getOwnPatientId(caller: AuthenticatedUser, hospitalId: string): Promise<string> {
    const patient = await TenantContext.run(
      { hospitalId, userId: caller.sub, bypassTenancy: false },
      () => this.prisma.patientProfile.findUnique({ where: { userId: caller.sub } }),
    );
    if (!patient) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "No patient profile is linked to the current account.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return patient.id;
  }

  /**
   * Two truly concurrent bookings for the same slot don't only race to
   * violate `no_doctor_overlap`/`no_patient_overlap` (Postgres `23P01`) —
   * inserting two overlapping tsranges into the same EXCLUDE USING gist
   * index concurrently can also make Postgres detect a deadlock between the
   * two transactions' index-page locks and abort the loser with `40P01`
   * instead, with no `23P01` anywhere in that transaction's own error. Found
   * live in Phase 5 mandatory concurrency testing: the exact same booking
   * race intermittently produced a 500 instead of the expected 409 because
   * `40P01` wasn't recognised. Confirmed via a direct-to-Postgres repro
   * (25/25 truly concurrent inserts against this same constraint raised
   * `40P01`, never `23P01`) — so both codes are the DB's word for "you lost
   * this booking race," not just the exclusion violation.
   */
  private translateBookingConflict(err: unknown): never {
    const isExclusionViolation =
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2004") ||
      (err instanceof Error &&
        /no_doctor_overlap|no_patient_overlap|exclusion|23P01|40P01/i.test(err.message));
    if (isExclusionViolation) {
      throw new AppException(
        ApiErrorCode.SLOT_UNAVAILABLE,
        "This time slot is no longer available. Please choose another.",
        HttpStatus.CONFLICT,
      );
    }
    throw err as Error;
  }

  async book(dto: BookAppointmentDto, caller: AuthenticatedUser) {
    if (!caller.hospitalId) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "A Super Admin cannot book appointments; a hospital-scoped account is required.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const hospitalId = caller.hospitalId;

    let patientId: string;
    if (caller.role === UserRole.PATIENT) {
      if (dto.patientId) {
        throw new AppException(
          ApiErrorCode.VALIDATION_ERROR,
          "Patients book only for themselves; do not supply patientId.",
          HttpStatus.BAD_REQUEST,
        );
      }
      patientId = await this.getOwnPatientId(caller, hospitalId);
    } else {
      if (!dto.patientId) {
        throw new AppException(
          ApiErrorCode.VALIDATION_ERROR,
          "patientId is required when booking on behalf of a patient.",
          HttpStatus.BAD_REQUEST,
        );
      }
      const patient = await TenantContext.run(
        { hospitalId, userId: caller.sub, bypassTenancy: false },
        () => this.prisma.patientProfile.findUnique({ where: { id: dto.patientId } }),
      );
      if (!patient) throw new NotFoundException("Patient not found.");
      patientId = patient.id;
    }

    const doctor = await TenantContext.run(
      { hospitalId, userId: caller.sub, bypassTenancy: false },
      () => this.prisma.doctorProfile.findUnique({ where: { id: dto.doctorId } }),
    );
    if (!doctor) throw new NotFoundException("Doctor not found.");

    const scheduledStart = new Date(dto.scheduledStart);
    const scheduledEnd = new Date(dto.scheduledEnd);
    if (
      Number.isNaN(scheduledStart.getTime()) ||
      Number.isNaN(scheduledEnd.getTime()) ||
      scheduledStart >= scheduledEnd
    ) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "scheduledStart must be a valid timestamp before scheduledEnd.",
        HttpStatus.BAD_REQUEST,
      );
    }

    // FR-APPT-002 — re-verify the requested window is a genuinely open,
    // schedule-aligned slot, not just any client-chosen timestamp pair. The
    // DB exclusion constraint is the final word on a true race, but this
    // check rejects a fabricated/misaligned slot before it ever reaches SQL.
    const dateKey = scheduledStart.toISOString().slice(0, 10);
    const [day] = await this.availabilityService.computeAvailability(
      doctor.id,
      caller,
      dateKey,
      dateKey,
    );
    const isOpenSlot = day?.slots.some(
      (slot) =>
        slot.start.getTime() === scheduledStart.getTime() &&
        slot.end.getTime() === scheduledEnd.getTime(),
    );
    if (!isOpenSlot) {
      throw new AppException(
        ApiErrorCode.SLOT_UNAVAILABLE,
        "The requested time is not an open slot for this doctor.",
        HttpStatus.CONFLICT,
      );
    }

    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      try {
        return await this.prisma.appointment.create({
          data: {
            hospitalId,
            patientId,
            doctorId: doctor.id,
            departmentId: doctor.departmentId,
            scheduledStart,
            scheduledEnd,
            reasonForVisit: dto.reasonForVisit,
            createdBy: caller.sub,
          },
          include: APPOINTMENT_INCLUDE,
        });
      } catch (err) {
        this.translateBookingConflict(err);
      }
    });
  }

  async bookEmergency(dto: CreateEmergencyAppointmentDto, caller: AuthenticatedUser) {
    if (!caller.hospitalId) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "A Super Admin cannot book appointments; a hospital-scoped account is required.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const hospitalId = caller.hospitalId;

    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      const [doctor, patient, defaultSlot] = await Promise.all([
        this.prisma.doctorProfile.findUnique({ where: { id: dto.doctorId } }),
        this.prisma.patientProfile.findUnique({ where: { id: dto.patientId } }),
        this.prisma.doctorAvailability.findFirst({ where: { doctorId: dto.doctorId } }),
      ]);
      if (!doctor) throw new NotFoundException("Doctor not found.");
      if (!patient) throw new NotFoundException("Patient not found.");

      const scheduledStart = new Date();
      const durationMinutes = defaultSlot?.slotDurationMinutes ?? 30;
      const scheduledEnd = new Date(scheduledStart.getTime() + durationMinutes * 60_000);

      try {
        return await this.prisma.appointment.create({
          data: {
            hospitalId,
            patientId: patient.id,
            doctorId: doctor.id,
            departmentId: doctor.departmentId,
            scheduledStart,
            scheduledEnd,
            status: AppointmentStatus.CONFIRMED,
            type: AppointmentType.EMERGENCY,
            reasonForVisit: dto.reasonForVisit,
            createdBy: caller.sub,
          },
          include: APPOINTMENT_INCLUDE,
        });
      } catch (err) {
        this.translateBookingConflict(err);
      }
    });
  }

  async updateStatus(id: string, dto: UpdateAppointmentStatusDto, caller: AuthenticatedUser) {
    if (!caller.hospitalId) throw new NotFoundException("Appointment not found.");
    const hospitalId = caller.hospitalId;

    const appointment = await TenantContext.run(
      { hospitalId, userId: caller.sub, bypassTenancy: false },
      () => this.prisma.appointment.findUnique({ where: { id }, include: APPOINTMENT_INCLUDE }),
    );
    if (!appointment) throw new NotFoundException("Appointment not found.");

    if (caller.role === UserRole.DOCTOR && appointment.doctor.userId !== caller.sub) {
      throw new NotFoundException("Appointment not found.");
    }
    if (caller.role === UserRole.PATIENT && appointment.patient.userId !== caller.sub) {
      throw new NotFoundException("Appointment not found.");
    }

    const allowedTargets = ALLOWED_TRANSITIONS[caller.role]?.[appointment.status] ?? [];
    if (!allowedTargets.includes(dto.status)) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        `Cannot transition an appointment from ${appointment.status} to ${dto.status} as ${caller.role}.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (dto.status === AppointmentStatus.CANCELLED && !dto.cancelledReason) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "cancelledReason is required when cancelling an appointment.",
        HttpStatus.BAD_REQUEST,
      );
    }

    const updated = await TenantContext.run(
      { hospitalId, userId: caller.sub, bypassTenancy: false },
      () =>
        this.prisma.appointment.update({
          where: { id },
          data: {
            status: dto.status,
            ...(dto.status === AppointmentStatus.CANCELLED
              ? { cancelledReason: dto.cancelledReason, cancelledBy: caller.sub }
              : {}),
          },
          include: APPOINTMENT_INCLUDE,
        }),
    );

    if (dto.status === AppointmentStatus.CONFIRMED) {
      await this.safeReminderCall(
        () => this.reminderQueue.scheduleReminders(id, updated.scheduledStart),
        "scheduling",
      );
    } else if (dto.status === AppointmentStatus.CANCELLED || dto.status === AppointmentStatus.NO_SHOW) {
      await this.safeReminderCall(() => this.reminderQueue.cancelReminders(id), "cancellation");
    }

    return updated;
  }

  async findAll(query: FindAppointmentsQueryDto, caller: AuthenticatedUser) {
    const baseWhere: Record<string, unknown> = { deletedAt: null };
    if (query.status) baseWhere.status = query.status;
    if (query.dateFrom || query.dateTo) {
      baseWhere.scheduledStart = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    if (caller.role === UserRole.SUPER_ADMIN) {
      return TenantContext.bypass(async () => {
        const [data, total] = await Promise.all([
          this.prisma.appointment.findMany({
            where: baseWhere,
            skip: query.skip,
            take: query.limit,
            orderBy: { scheduledStart: "desc" },
            include: APPOINTMENT_INCLUDE,
          }),
          this.prisma.appointment.count({ where: baseWhere }),
        ]);
        return PaginatedResult.of(data, total, query.page, query.limit);
      });
    }

    if (!caller.hospitalId) return PaginatedResult.of([], 0, query.page, query.limit);
    const hospitalId = caller.hospitalId;

    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      const where = { ...baseWhere };
      if (caller.role === UserRole.DOCTOR) {
        const doctor = await this.prisma.doctorProfile.findUnique({ where: { userId: caller.sub } });
        where.doctorId = doctor?.id ?? "__no_profile__";
      } else if (caller.role === UserRole.PATIENT) {
        const patient = await this.prisma.patientProfile.findUnique({ where: { userId: caller.sub } });
        where.patientId = patient?.id ?? "__no_profile__";
      }

      const [data, total] = await Promise.all([
        this.prisma.appointment.findMany({
          where,
          skip: query.skip,
          take: query.limit,
          orderBy: { scheduledStart: "desc" },
          include: APPOINTMENT_INCLUDE,
        }),
        this.prisma.appointment.count({ where }),
      ]);
      return PaginatedResult.of(data, total, query.page, query.limit);
    });
  }

  async findOne(id: string, caller: AuthenticatedUser) {
    const appointment =
      caller.role === UserRole.SUPER_ADMIN
        ? await TenantContext.bypass(() =>
            this.prisma.appointment.findUnique({ where: { id }, include: APPOINTMENT_INCLUDE }),
          )
        : caller.hospitalId
          ? await TenantContext.run(
              { hospitalId: caller.hospitalId, userId: caller.sub, bypassTenancy: false },
              () =>
                this.prisma.appointment.findUnique({ where: { id }, include: APPOINTMENT_INCLUDE }),
            )
          : null;

    if (!appointment) throw new NotFoundException("Appointment not found.");
    if (caller.role === UserRole.DOCTOR && appointment.doctor.userId !== caller.sub) {
      throw new NotFoundException("Appointment not found.");
    }
    if (caller.role === UserRole.PATIENT && appointment.patient.userId !== caller.sub) {
      throw new NotFoundException("Appointment not found.");
    }
    return appointment;
  }
}
