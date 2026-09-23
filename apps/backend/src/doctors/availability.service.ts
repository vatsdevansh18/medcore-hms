import { HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ApiErrorCode, AppointmentStatus, UserRole } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { AppException } from "../common/errors/app-exception";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import type { SetAvailabilityDto } from "./dto/availability-slot.dto";
import type { CreateAvailabilityExceptionDto } from "./dto/create-availability-exception.dto";

/** A single bookable window on one calendar date. */
export interface ComputedSlot {
  start: Date;
  end: Date;
}

export interface DaySlots {
  date: string;
  slots: ComputedSlot[];
}

const MAX_RANGE_DAYS = 31;

/**
 * `DoctorAvailability`/`DoctorAvailabilityException` carry no `hospitalId`
 * column (docs/03-ARCHITECTURE.md §5 — Layer 2 models), so every method here
 * does the resource-ownership check explicitly: the `:id` in the route is a
 * `DoctorProfile.id`, resolved and hospital-checked first, before any
 * availability row is touched.
 *
 * All wall-clock times (`DoctorAvailability.startTime`/`endTime`,
 * `Appointment.scheduledStart`/`scheduledEnd`) are treated as UTC for v1 —
 * `Hospital.timezone` is stored but not yet consulted by scheduling logic,
 * a documented simplification (docs/11-DECISIONS.md) rather than an
 * oversight; every hospital in this deployment is assumed to operate on UTC
 * wall-clock time until real per-hospital timezone conversion is built.
 */
@Injectable()
export class AvailabilityService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  private async loadDoctorForCaller(doctorId: string, caller: AuthenticatedUser) {
    if (!caller.hospitalId) throw new NotFoundException("Doctor not found.");
    const doctor = await TenantContext.run(
      { hospitalId: caller.hospitalId, userId: caller.sub, bypassTenancy: false },
      () => this.prisma.doctorProfile.findUnique({ where: { id: doctorId } }),
    );
    if (!doctor) throw new NotFoundException("Doctor not found.");
    return doctor;
  }

  private assertSelf(doctor: { userId: string }, caller: AuthenticatedUser): void {
    if (caller.role !== UserRole.DOCTOR || doctor.userId !== caller.sub) {
      throw new NotFoundException("Doctor not found.");
    }
  }

  async setAvailability(doctorId: string, dto: SetAvailabilityDto, caller: AuthenticatedUser) {
    const doctor = await this.loadDoctorForCaller(doctorId, caller);
    this.assertSelf(doctor, caller);

    for (const slot of dto.slots) {
      if (slot.startTime >= slot.endTime) {
        throw new AppException(
          ApiErrorCode.VALIDATION_ERROR,
          `Slot for day ${slot.dayOfWeek}: startTime must be before endTime.`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    return TenantContext.run(
      { hospitalId: caller.hospitalId!, userId: caller.sub, bypassTenancy: false },
      async () => {
        await this.prisma.doctorAvailability.deleteMany({ where: { doctorId } });
        if (dto.slots.length > 0) {
          await this.prisma.doctorAvailability.createMany({
            data: dto.slots.map((slot) => ({
              doctorId,
              dayOfWeek: slot.dayOfWeek,
              startTime: slot.startTime,
              endTime: slot.endTime,
              slotDurationMinutes: slot.slotDurationMinutes,
              isActive: slot.isActive ?? true,
            })),
          });
        }
        return this.prisma.doctorAvailability.findMany({
          where: { doctorId },
          orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
        });
      },
    );
  }

  async createException(
    doctorId: string,
    dto: CreateAvailabilityExceptionDto,
    caller: AuthenticatedUser,
  ) {
    const doctor = await this.loadDoctorForCaller(doctorId, caller);
    this.assertSelf(doctor, caller);

    if (!dto.isUnavailable && (!dto.startTime || !dto.endTime)) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "A custom-hours exception (isUnavailable: false) requires both startTime and endTime.",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dto.startTime && dto.endTime && dto.startTime >= dto.endTime) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "startTime must be before endTime.",
        HttpStatus.BAD_REQUEST,
      );
    }

    return TenantContext.run(
      { hospitalId: caller.hospitalId!, userId: caller.sub, bypassTenancy: false },
      () =>
        this.prisma.doctorAvailabilityException.upsert({
          where: { doctorId_date: { doctorId, date: new Date(`${dto.date}T00:00:00.000Z`) } },
          create: {
            doctorId,
            date: new Date(`${dto.date}T00:00:00.000Z`),
            isUnavailable: dto.isUnavailable,
            startTime: dto.startTime,
            endTime: dto.endTime,
            reason: dto.reason,
          },
          update: {
            isUnavailable: dto.isUnavailable,
            startTime: dto.startTime,
            endTime: dto.endTime,
            reason: dto.reason,
          },
        }),
    );
  }

  /** FR-APPT-002 — computed open slots for `[dateFrom, dateTo]` (inclusive),
   * recurring weekly availability minus date exceptions minus already-booked
   * (non-CANCELLED/NO_SHOW) appointments. Read access is broader than write
   * for most roles (docs/07-RBAC-MATRIX.md §3.3: HOSPITAL_ADMIN/NURSE/
   * RECEPTIONIST/PATIENT may view any doctor in their own hospital) but the
   * matrix restricts DOCTOR to "self" specifically, unlike the other
   * roles' "own hospital" — a doctor may not browse a colleague's calendar
   * through this endpoint, so that case gets the same ownership check as
   * the write methods, on top of the controller's `@Roles()` role check. */
  async computeAvailability(
    doctorId: string,
    caller: AuthenticatedUser,
    dateFrom: string,
    dateTo: string,
  ): Promise<DaySlots[]> {
    const doctor = await this.loadDoctorForCaller(doctorId, caller);
    if (caller.role === UserRole.DOCTOR && doctor.userId !== caller.sub) {
      throw new NotFoundException("Doctor not found.");
    }

    const start = new Date(`${dateFrom}T00:00:00.000Z`);
    const end = new Date(`${dateTo}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "dateFrom must be a valid date on or before dateTo.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const rangeDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (rangeDays > MAX_RANGE_DAYS) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        `Date range cannot exceed ${MAX_RANGE_DAYS} days.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return TenantContext.run(
      { hospitalId: caller.hospitalId!, userId: caller.sub, bypassTenancy: false },
      async () => {
        const rangeEndExclusive = new Date(end.getTime() + 86_400_000);

        const [weekly, exceptions, appointments] = await Promise.all([
          this.prisma.doctorAvailability.findMany({ where: { doctorId, isActive: true } }),
          this.prisma.doctorAvailabilityException.findMany({
            where: { doctorId, date: { gte: start, lt: rangeEndExclusive } },
          }),
          this.prisma.appointment.findMany({
            where: {
              doctorId,
              scheduledStart: { gte: start, lt: rangeEndExclusive },
              status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] },
            },
          }),
        ]);

        const exceptionsByDate = new Map(
          exceptions.map((exception) => [exception.date.toISOString().slice(0, 10), exception]),
        );
        const weeklyByDay = new Map<number, typeof weekly>();
        for (const row of weekly) {
          const list = weeklyByDay.get(row.dayOfWeek) ?? [];
          list.push(row);
          weeklyByDay.set(row.dayOfWeek, list);
        }

        const result: DaySlots[] = [];
        for (let cursor = new Date(start); cursor <= end; cursor = new Date(cursor.getTime() + 86_400_000)) {
          const dateKey = cursor.toISOString().slice(0, 10);
          const exception = exceptionsByDate.get(dateKey);

          let windows: { startTime: string; endTime: string; slotDurationMinutes: number }[];
          if (exception?.isUnavailable) {
            windows = [];
          } else if (exception && exception.startTime && exception.endTime) {
            const fallbackDuration = weeklyByDay.get(cursor.getUTCDay())?.[0]?.slotDurationMinutes ?? 30;
            windows = [
              {
                startTime: exception.startTime,
                endTime: exception.endTime,
                slotDurationMinutes: fallbackDuration,
              },
            ];
          } else {
            windows = weeklyByDay.get(cursor.getUTCDay()) ?? [];
          }

          const daySlots = windows.flatMap((window) =>
            this.generateCandidateSlots(dateKey, window),
          );

          const now = new Date();
          const freeSlots = daySlots.filter(
            (slot) =>
              slot.start > now &&
              !appointments.some(
                (appt) => slot.start < appt.scheduledEnd && slot.end > appt.scheduledStart,
              ),
          );

          result.push({ date: dateKey, slots: freeSlots });
        }

        return result;
      },
    );
  }

  private generateCandidateSlots(
    dateKey: string,
    window: { startTime: string; endTime: string; slotDurationMinutes: number },
  ): ComputedSlot[] {
    const slots: ComputedSlot[] = [];
    let cursor = new Date(`${dateKey}T${window.startTime}:00.000Z`);
    const windowEnd = new Date(`${dateKey}T${window.endTime}:00.000Z`);
    const durationMs = window.slotDurationMinutes * 60_000;

    while (cursor.getTime() + durationMs <= windowEnd.getTime()) {
      const slotEnd = new Date(cursor.getTime() + durationMs);
      slots.push({ start: cursor, end: slotEnd });
      cursor = slotEnd;
    }
    return slots;
  }
}
