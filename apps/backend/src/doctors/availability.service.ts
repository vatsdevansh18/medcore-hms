import { HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ApiErrorCode, AppointmentStatus, UserRole } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { AppException } from "../common/errors/app-exception";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { addDaysToKey, localDateKey, weekdayOf, zonedWallTimeToUtc } from "../common/time/zoned-time";
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
 * `DoctorAvailability.startTime`/`endTime` (and exception times) are the
 * doctor's local wall-clock times in the hospital's `Hospital.timezone`;
 * `Appointment.scheduledStart`/`scheduledEnd` are UTC instants. The
 * `dateFrom`/`dateTo` range and each `DaySlots.date` are the hospital's local
 * calendar dates. (Until Phase 12 every wall-clock time was treated as UTC;
 * docs/11-DECISIONS.md D-037 records the fix.)
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
    // Two windows on one weekday may touch but not overlap: overlapping
    // windows would offer the same time twice (added with the availability
    // editor, D-042). HH:mm strings compare correctly as text.
    const byDay = [...dto.slots].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < byDay.length; i++) {
      const prev = byDay[i - 1];
      const cur = byDay[i];
      if (prev.dayOfWeek === cur.dayOfWeek && cur.startTime < prev.endTime) {
        throw new AppException(
          ApiErrorCode.VALIDATION_ERROR,
          `Day ${cur.dayOfWeek}: ${prev.startTime}-${prev.endTime} and ${cur.startTime}-${cur.endTime} overlap.`,
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

  /** The doctor's own schedule for the availability editor (Phase 13B
   * follow-up, D-042): the weekly hours, and exceptions from today (the
   * hospital's calendar) onward. Self only, like the writes. */
  async getSchedule(doctorId: string, caller: AuthenticatedUser) {
    const doctor = await this.loadDoctorForCaller(doctorId, caller);
    this.assertSelf(doctor, caller);
    return TenantContext.run(
      { hospitalId: caller.hospitalId!, userId: caller.sub, bypassTenancy: false },
      async () => {
        const hospital = await this.prisma.hospital.findUniqueOrThrow({
          where: { id: caller.hospitalId! },
          select: { timezone: true },
        });
        const today = localDateKey(new Date(), hospital.timezone);
        const [weekly, exceptions] = await Promise.all([
          this.prisma.doctorAvailability.findMany({
            where: { doctorId },
            orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
            select: { id: true, dayOfWeek: true, startTime: true, endTime: true, slotDurationMinutes: true, isActive: true },
          }),
          this.prisma.doctorAvailabilityException.findMany({
            where: { doctorId, date: { gte: new Date(`${today}T00:00:00.000Z`) } },
            orderBy: { date: "asc" },
            take: 100,
            select: { id: true, date: true, isUnavailable: true, startTime: true, endTime: true, reason: true },
          }),
        ]);
        return {
          timezone: hospital.timezone,
          weekly,
          exceptions: exceptions.map((e) => ({ ...e, date: e.date.toISOString().slice(0, 10) })),
        };
      },
    );
  }

  /** Removes one date's exception, restoring the weekly hours for that day. */
  async deleteException(doctorId: string, date: string, caller: AuthenticatedUser) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime())) {
      throw new AppException(ApiErrorCode.VALIDATION_ERROR, "date must be YYYY-MM-DD.", HttpStatus.BAD_REQUEST);
    }
    const doctor = await this.loadDoctorForCaller(doctorId, caller);
    this.assertSelf(doctor, caller);
    const { count } = await TenantContext.run(
      { hospitalId: caller.hospitalId!, userId: caller.sub, bypassTenancy: false },
      () => this.prisma.doctorAvailabilityException.deleteMany({ where: { doctorId, date: new Date(`${date}T00:00:00.000Z`) } }),
    );
    if (count === 0) throw new NotFoundException("No exception on that date.");
    return { date, removed: true };
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
        // Exception dates are calendar dates (Postgres DATE, UTC midnight).
        const rangeEndExclusive = new Date(end.getTime() + 86_400_000);
        const hospital = await this.prisma.hospital.findUnique({
          where: { id: doctor.hospitalId },
          select: { timezone: true },
        });
        const timeZone = hospital?.timezone ?? "Asia/Kolkata";
        // The instants covering the local dates, with a day's margin either
        // side so an appointment overlapping a range edge is still seen.
        const windowStart = zonedWallTimeToUtc(addDaysToKey(dateFrom, -1), "00:00", timeZone);
        const windowEnd = zonedWallTimeToUtc(addDaysToKey(dateTo, 2), "00:00", timeZone);

        const [weekly, exceptions, appointments] = await Promise.all([
          this.prisma.doctorAvailability.findMany({ where: { doctorId, isActive: true } }),
          this.prisma.doctorAvailabilityException.findMany({
            where: { doctorId, date: { gte: start, lt: rangeEndExclusive } },
          }),
          this.prisma.appointment.findMany({
            where: {
              doctorId,
              scheduledStart: { gte: windowStart, lt: windowEnd },
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
            const fallbackDuration = weeklyByDay.get(weekdayOf(dateKey))?.[0]?.slotDurationMinutes ?? 30;
            windows = [
              {
                startTime: exception.startTime,
                endTime: exception.endTime,
                slotDurationMinutes: fallbackDuration,
              },
            ];
          } else {
            windows = weeklyByDay.get(weekdayOf(dateKey)) ?? [];
          }

          const daySlots = windows.flatMap((window) =>
            this.generateCandidateSlots(dateKey, window, timeZone),
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
    timeZone: string,
  ): ComputedSlot[] {
    const slots: ComputedSlot[] = [];
    let cursor = zonedWallTimeToUtc(dateKey, window.startTime, timeZone);
    const windowEnd = zonedWallTimeToUtc(dateKey, window.endTime, timeZone);
    const durationMs = window.slotDurationMinutes * 60_000;

    while (cursor.getTime() + durationMs <= windowEnd.getTime()) {
      const slotEnd = new Date(cursor.getTime() + durationMs);
      slots.push({ start: cursor, end: slotEnd });
      cursor = slotEnd;
    }
    return slots;
  }
}
