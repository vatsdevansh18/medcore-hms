import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ApiErrorCode, AppointmentStatus, AppointmentType, NotificationType, UserRole } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { AppException } from "../common/errors/app-exception";
import { SAFE_USER_SELECT } from "../common/prisma/safe-user-select";
import { PaginatedResult } from "../common/pagination/paginated-result";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { AvailabilityService } from "../doctors/availability.service";
import { AppointmentReminderQueueService } from "../queue/appointment-reminder-queue.service";
import { NotificationsService } from "../notifications/notifications.service";
import { doctorName, formatHospitalTime } from "../notifications/notification-format";
import type { BookAppointmentDto } from "./dto/book-appointment.dto";
import type { CreateEmergencyAppointmentDto } from "./dto/create-emergency-appointment.dto";
import type { UpdateAppointmentStatusDto } from "./dto/update-appointment-status.dto";
import type { FindAppointmentsQueryDto } from "./dto/find-appointments-query.dto";
import type { RescheduleAppointmentDto } from "./dto/reschedule-appointment.dto";
import { localDateKey } from "../common/time/zoned-time";

/** The doctor side is a narrow projection: every role reading an
 * appointment (including the patient) sees the doctor's name and
 * specialization, never their contact details or the signature image's
 * storage key (docs/11-DECISIONS.md D-036). */
const APPOINTMENT_INCLUDE = {
  doctor: {
    select: {
      id: true,
      userId: true,
      departmentId: true,
      specialization: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  patient: { include: { user: { select: SAFE_USER_SELECT } } },
} as const;

/** Statuses a patient may still move to a different time (D-035). */
const RESCHEDULABLE_STATUSES: AppointmentStatus[] = [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED];

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
    private readonly notifications: NotificationsService,
  ) {}

  private async hospitalTimezone(hospitalId: string): Promise<string> {
    const hospital = await this.prisma.hospital.findUnique({ where: { id: hospitalId }, select: { timezone: true } });
    return hospital?.timezone ?? "Asia/Kolkata";
  }

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

  /**
   * FR-APPT-002: the requested window must be a genuinely open,
   * schedule-aligned slot, not just any client-chosen timestamp pair. The DB
   * exclusion constraint is the final word on a true race, but this check
   * rejects a fabricated/misaligned slot before it ever reaches SQL. The slot
   * is looked up on the hospital-local date it starts on (D-037).
   */
  private async assertOpenSlot(
    doctorId: string,
    caller: AuthenticatedUser,
    hospitalId: string,
    startInput: string,
    endInput: string,
  ): Promise<{ scheduledStart: Date; scheduledEnd: Date }> {
    const scheduledStart = new Date(startInput);
    const scheduledEnd = new Date(endInput);
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

    const dateKey = localDateKey(scheduledStart, await this.hospitalTimezone(hospitalId));
    const [day] = await this.availabilityService.computeAvailability(doctorId, caller, dateKey, dateKey);
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
    return { scheduledStart, scheduledEnd };
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

    const { scheduledStart, scheduledEnd } = await this.assertOpenSlot(
      doctor.id,
      caller,
      hospitalId,
      dto.scheduledStart,
      dto.scheduledEnd,
    );

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

      let created;
      try {
        created = await this.prisma.$transaction(async (tx) => {
          const appointment = await tx.appointment.create({
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
          // Brief §7.8 "Emergency appointment created": In-app + SMS to the
          // doctor. No patient detail in the text (it may go out by SMS).
          await this.notifications.record(tx, {
            type: NotificationType.EMERGENCY_APPOINTMENT,
            hospitalId,
            recipientUserIds: [doctor.userId],
            title: "Emergency appointment",
            body: "An emergency appointment has been assigned to you, starting now. Open MedCore HMS for details.",
            relatedEntityType: "Appointment",
            relatedEntityId: appointment.id,
            dedupeKey: `${NotificationType.EMERGENCY_APPOINTMENT}:${appointment.id}`,
          });
          return appointment;
        });
      } catch (err) {
        this.translateBookingConflict(err);
      }
      this.notifications.publish();
      return created;
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

    const timezone = await this.hospitalTimezone(hospitalId);
    const updated = await TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, () =>
      this.prisma.$transaction(async (tx) => {
        let row;
        try {
          // Conditional on the status the transition was validated against:
          // of two concurrent transitions, the second fails instead of
          // silently re-applying (and re-notifying).
          row = await tx.appointment.update({
            where: { id, status: appointment.status },
            data: {
              status: dto.status,
              ...(dto.status === AppointmentStatus.CANCELLED
                ? { cancelledReason: dto.cancelledReason, cancelledBy: caller.sub }
                : {}),
            },
            include: APPOINTMENT_INCLUDE,
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
            throw new AppException(
              ApiErrorCode.VALIDATION_ERROR,
              "The appointment's status changed while this request was in flight. Reload and try again.",
              HttpStatus.CONFLICT,
            );
          }
          throw err;
        }
        if (dto.status === AppointmentStatus.CONFIRMED) {
          // Brief §7.8 "Appointment confirmed": Email + SMS + In-app, patient.
          await this.notifications.record(tx, {
            type: NotificationType.APPOINTMENT_CONFIRMED,
            hospitalId,
            recipientUserIds: [row.patient.userId],
            title: "Appointment confirmed",
            body: `Your appointment with ${doctorName(row.doctor.user)} on ${formatHospitalTime(row.scheduledStart, timezone)} is confirmed.`,
            relatedEntityType: "Appointment",
            relatedEntityId: row.id,
            dedupeKey: `${NotificationType.APPOINTMENT_CONFIRMED}:${row.id}`,
          });
        }
        return row;
      }),
    );
    this.notifications.publish();

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

  /**
   * FR-PORTAL-002: a patient moves their own PENDING or CONFIRMED appointment
   * to another open slot with the same doctor, if the hospital allows it and
   * the current start is more than the cutoff away (docs/11-DECISIONS.md
   * D-035). The appointment keeps its id and goes back to PENDING, so staff
   * confirm the new time (which schedules fresh reminders); the old
   * reminders are cancelled. The move is one conditional UPDATE: the DB
   * exclusion constraints decide a race for the new slot, and a concurrent
   * status change or second reschedule gets a 409.
   */
  async reschedule(id: string, dto: RescheduleAppointmentDto, caller: AuthenticatedUser) {
    if (!caller.hospitalId) throw new NotFoundException("Appointment not found.");
    const hospitalId = caller.hospitalId;
    const scope = { hospitalId, userId: caller.sub, bypassTenancy: false };

    const [appointment, hospital] = await TenantContext.run(scope, () =>
      Promise.all([
        this.prisma.appointment.findUnique({ where: { id }, include: APPOINTMENT_INCLUDE }),
        this.prisma.hospital.findUnique({
          where: { id: hospitalId },
          select: { patientRescheduleAllowed: true, patientRescheduleCutoffHours: true },
        }),
      ]),
    );
    if (!appointment || appointment.deletedAt || appointment.patient.userId !== caller.sub) {
      throw new NotFoundException("Appointment not found.");
    }

    if (!hospital?.patientRescheduleAllowed) {
      throw new AppException(
        ApiErrorCode.RESCHEDULE_NOT_ALLOWED,
        "This hospital doesn't allow appointments to be rescheduled online. Please contact the front desk.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (appointment.type === AppointmentType.EMERGENCY) {
      throw new AppException(
        ApiErrorCode.RESCHEDULE_NOT_ALLOWED,
        "Emergency appointments can't be rescheduled.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (!RESCHEDULABLE_STATUSES.includes(appointment.status)) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        `A ${appointment.status} appointment can't be rescheduled.`,
        HttpStatus.CONFLICT,
      );
    }
    const cutoffMs = hospital.patientRescheduleCutoffHours * 3_600_000;
    if (appointment.scheduledStart.getTime() - Date.now() < cutoffMs) {
      throw new AppException(
        ApiErrorCode.RESCHEDULE_NOT_ALLOWED,
        `Appointments can only be rescheduled online more than ${hospital.patientRescheduleCutoffHours} hours in advance. Please contact the front desk.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        { cutoffHours: hospital.patientRescheduleCutoffHours },
      );
    }

    const { scheduledStart, scheduledEnd } = await this.assertOpenSlot(
      appointment.doctorId,
      caller,
      hospitalId,
      dto.scheduledStart,
      dto.scheduledEnd,
    );

    const updated = await TenantContext.run(scope, async () => {
      try {
        return await this.prisma.appointment.update({
          // Conditional on the state that was just validated.
          where: { id, status: appointment.status, scheduledStart: appointment.scheduledStart },
          data: { scheduledStart, scheduledEnd, status: AppointmentStatus.PENDING },
          include: APPOINTMENT_INCLUDE,
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
          throw new AppException(
            ApiErrorCode.VALIDATION_ERROR,
            "The appointment changed while this request was in flight. Reload and try again.",
            HttpStatus.CONFLICT,
          );
        }
        this.translateBookingConflict(err);
      }
    });

    await this.safeReminderCall(() => this.reminderQueue.cancelReminders(id), "cancellation");
    return updated;
  }

  async findAll(query: FindAppointmentsQueryDto, caller: AuthenticatedUser) {
    const baseWhere: Record<string, unknown> = { deletedAt: null };
    if (query.status) baseWhere.status = { in: query.status };
    if (query.doctorId) baseWhere.doctorId = query.doctorId;
    if (query.patientId) baseWhere.patientId = query.patientId;
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
            orderBy: { scheduledStart: query.sortOrder ?? "desc" },
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
        const own = doctor?.id ?? "__no_profile__";
        // A doctorId filter narrows within the doctor's own scope: asking for
        // a colleague's appointments returns nothing, never your own.
        if (query.doctorId && query.doctorId !== own) {
          return PaginatedResult.of([], 0, query.page, query.limit);
        }
        where.doctorId = own;
      } else if (caller.role === UserRole.PATIENT) {
        const patient = await this.prisma.patientProfile.findUnique({ where: { userId: caller.sub } });
        const own = patient?.id ?? "__no_profile__";
        // Same narrowing rule for patientId: another patient's id is empty.
        if (query.patientId && query.patientId !== own) {
          return PaginatedResult.of([], 0, query.page, query.limit);
        }
        where.patientId = own;
      }

      const [data, total] = await Promise.all([
        this.prisma.appointment.findMany({
          where,
          skip: query.skip,
          take: query.limit,
          orderBy: { scheduledStart: query.sortOrder ?? "desc" },
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
