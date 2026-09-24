import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ApiErrorCode,
  AppointmentStatus,
  BedStatus,
  HospitalStatus,
  InvoiceStatus,
  PaymentStatus,
  UserRole,
  UserStatus,
  type AppointmentTrend,
  type BedCounts,
  type DailyAppointments,
  type DailyRevenue,
  type DashboardKpis,
  type OccupancyView,
  type RevenueTrend,
} from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { AppException } from "../common/errors/app-exception";
import { addDaysToKey, localDateKey, zonedWallTimeToUtc } from "../common/time/zoned-time";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import type { DateRangeQueryDto } from "./dto/date-range-query.dto";

const MAX_RANGE_DAYS = 92;
const DEFAULT_RANGE_DAYS = 7;
const PLATFORM_TZ = "UTC";
const CURRENCY = "INR";
/** Statuses that don't occupy a clinician's time (same set the exclusion constraints ignore). */
const INACTIVE_APPOINTMENT_STATUSES = [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW];

/** Where a caller's numbers come from: one hospital (and, for a doctor,
 * only their own appointments), or the whole platform (Super Admin). */
interface Scope {
  kind: "HOSPITAL" | "PLATFORM";
  hospitalId: string | null;
  timeZone: string;
  doctorId: string | null;
  caller: AuthenticatedUser;
}

interface Range {
  from: string;
  to: string;
  /** UTC instants covering [from 00:00, to+1 00:00) in the scope's timezone. */
  start: Date;
  end: Date;
  days: string[];
}

/**
 * FR-ANALYTICS-001: the numbers behind the role dashboards
 * (docs/04-UI-UX.md §5, docs/11-DECISIONS.md D-040). Every figure is scoped
 * to the caller's hospital, taken from the JWT, or is platform-wide for a
 * Super Admin only. Days are calendar days in the hospital's timezone.
 * Grouping is done in SQL; raw queries bypass the tenant extension, so each
 * one binds `hospitalId` explicitly (CLAUDE.md).
 */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  private async scopeFor(caller: AuthenticatedUser): Promise<Scope> {
    if (caller.role === UserRole.SUPER_ADMIN) {
      return { kind: "PLATFORM", hospitalId: null, timeZone: PLATFORM_TZ, doctorId: null, caller };
    }
    if (!caller.hospitalId) {
      throw new AppException(ApiErrorCode.FORBIDDEN_ROLE, "A hospital-scoped account is required.", HttpStatus.FORBIDDEN);
    }
    const hospitalId = caller.hospitalId;
    return this.run({ kind: "HOSPITAL", hospitalId, caller }, async () => {
      const hospital = await this.prisma.hospital.findUnique({ where: { id: hospitalId }, select: { timezone: true } });
      let doctorId: string | null = null;
      if (caller.role === UserRole.DOCTOR) {
        const doctor = await this.prisma.doctorProfile.findUnique({ where: { userId: caller.sub }, select: { id: true } });
        // A doctor account without a profile sees nothing rather than everything.
        doctorId = doctor?.id ?? "__no_profile__";
      }
      return { kind: "HOSPITAL", hospitalId, timeZone: hospital?.timezone ?? "Asia/Kolkata", doctorId, caller };
    });
  }

  private run<T>(scope: Pick<Scope, "kind" | "hospitalId" | "caller">, fn: () => Promise<T>): Promise<T> {
    return scope.kind === "PLATFORM"
      ? TenantContext.bypass(fn)
      : TenantContext.run({ hospitalId: scope.hospitalId!, userId: scope.caller.sub, bypassTenancy: false }, fn);
  }

  private range(query: DateRangeQueryDto, timeZone: string): Range {
    const today = localDateKey(new Date(), timeZone);
    const to = query.to ?? today;
    const from = query.from ?? addDaysToKey(to, -(DEFAULT_RANGE_DAYS - 1));
    const valid = (key: string) => !Number.isNaN(Date.parse(`${key}T00:00:00Z`)) && addDaysToKey(key, 0) === key;
    if (!valid(from) || !valid(to)) {
      throw new AppException(ApiErrorCode.VALIDATION_ERROR, "from and to must be real calendar dates.", HttpStatus.BAD_REQUEST);
    }
    if (from > to) {
      throw new AppException(ApiErrorCode.VALIDATION_ERROR, "from must be on or before to.", HttpStatus.BAD_REQUEST);
    }
    const days: string[] = [];
    for (let day = from; day <= to; day = addDaysToKey(day, 1)) {
      days.push(day);
      if (days.length > MAX_RANGE_DAYS) {
        throw new AppException(
          ApiErrorCode.VALIDATION_ERROR,
          `A date range can cover at most ${MAX_RANGE_DAYS} days.`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    return {
      from,
      to,
      start: zonedWallTimeToUtc(from, "00:00", timeZone),
      end: zonedWallTimeToUtc(addDaysToKey(to, 1), "00:00", timeZone),
      days,
    };
  }

  /** `timestamp` columns hold UTC wall time; this is the calendar day in `tz`. */
  private localDay(column: Prisma.Sql, timeZone: string): Prisma.Sql {
    return Prisma.sql`to_char((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD')`;
  }

  /** A bound instant as a UTC `timestamp`, matching Prisma's DateTime columns. */
  private instant(value: Date): Prisma.Sql {
    return Prisma.sql`(${value.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  }

  private hospitalFilter(alias: string, scope: Scope): Prisma.Sql {
    return scope.hospitalId
      ? Prisma.sql`AND ${Prisma.raw(`${alias}."hospitalId"`)} = ${scope.hospitalId}`
      : Prisma.empty;
  }

  /** `GET /analytics/overview`: Hospital Admin (own hospital), Super Admin (platform). */
  async overview(caller: AuthenticatedUser): Promise<DashboardKpis> {
    const scope = await this.scopeFor(caller);
    const date = localDateKey(new Date(), scope.timeZone);
    const start = zonedWallTimeToUtc(date, "00:00", scope.timeZone);
    const end = zonedWallTimeToUtc(addDaysToKey(date, 1), "00:00", scope.timeZone);
    const hospitalWhere = scope.hospitalId ? { hospitalId: scope.hospitalId } : {};

    return this.run(scope, async () => {
      const todaysAppointments = {
        ...hospitalWhere,
        deletedAt: null,
        scheduledStart: { gte: start, lt: end },
        status: { notIn: INACTIVE_APPOINTMENT_STATUSES },
      };
      const roomWhere = scope.hospitalId ? { room: { hospitalId: scope.hospitalId } } : {};
      const [appointmentsToday, patients, revenue, totalBeds, occupiedBeds, activeDoctors, activeHospitals] =
        await Promise.all([
          this.prisma.appointment.count({ where: todaysAppointments }),
          this.prisma.appointment.findMany({ where: todaysAppointments, distinct: ["patientId"], select: { patientId: true } }),
          this.prisma.payment.aggregate({
            where: { ...hospitalWhere, status: PaymentStatus.SUCCEEDED, createdAt: { gte: start, lt: end } },
            _sum: { amount: true },
          }),
          this.prisma.bed.count({ where: roomWhere }),
          this.prisma.bed.count({ where: { ...roomWhere, status: BedStatus.OCCUPIED } }),
          this.prisma.doctorProfile.count({
            where: { ...hospitalWhere, deletedAt: null, user: { status: UserStatus.ACTIVE, deletedAt: null } },
          }),
          scope.kind === "PLATFORM" ? this.prisma.hospital.count({ where: { status: HospitalStatus.ACTIVE } }) : null,
        ]);
      return {
        scope: scope.kind,
        date,
        timezone: scope.timeZone,
        appointmentsToday,
        patientsToday: patients.length,
        revenueToday: (revenue._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
        currency: CURRENCY,
        occupiedBeds,
        totalBeds,
        activeDoctors,
        ...(activeHospitals !== null ? { activeHospitals } : {}),
      };
    });
  }

  /** `GET /analytics/appointments`: Hospital Admin, Doctor (own appointments
   * only), Super Admin (platform). One entry per day, zero-filled. */
  async appointments(query: DateRangeQueryDto, caller: AuthenticatedUser): Promise<AppointmentTrend> {
    const scope = await this.scopeFor(caller);
    const range = this.range(query, scope.timeZone);
    const doctorFilter = scope.doctorId ? Prisma.sql`AND a."doctorId" = ${scope.doctorId}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ day: string; status: AppointmentStatus; n: number }[]>`
      SELECT ${this.localDay(Prisma.sql`a."scheduledStart"`, scope.timeZone)} AS "day",
             a."status"::text AS "status", COUNT(*)::int AS "n"
      FROM "Appointment" a
      WHERE a."deletedAt" IS NULL
        AND a."scheduledStart" >= ${this.instant(range.start)}
        AND a."scheduledStart" < ${this.instant(range.end)}
        ${this.hospitalFilter("a", scope)}
        ${doctorFilter}
      GROUP BY 1, 2`;

    const byDay = new Map<string, DailyAppointments>(
      range.days.map((date) => [date, { date, total: 0, byStatus: {} }]),
    );
    for (const row of rows) {
      const day = byDay.get(row.day);
      if (!day) continue;
      day.byStatus[row.status] = row.n;
      day.total += row.n;
    }
    return { scope: scope.kind, from: range.from, to: range.to, timezone: scope.timeZone, days: [...byDay.values()] };
  }

  /** `GET /analytics/revenue`: Hospital Admin, Accountant, Super Admin. */
  async revenue(query: DateRangeQueryDto, caller: AuthenticatedUser): Promise<RevenueTrend> {
    const scope = await this.scopeFor(caller);
    const range = this.range(query, scope.timeZone);
    const start = this.instant(range.start);
    const end = this.instant(range.end);

    const [collected, invoiced, outstanding] = await Promise.all([
      this.prisma.$queryRaw<{ day: string; method: string; amount: string }[]>`
        SELECT ${this.localDay(Prisma.sql`p."createdAt"`, scope.timeZone)} AS "day",
               p."method"::text AS "method", SUM(p."amount")::numeric(14,2)::text AS "amount"
        FROM "Payment" p
        WHERE p."status" = ${PaymentStatus.SUCCEEDED}::"PaymentStatus"
          AND p."createdAt" >= ${start} AND p."createdAt" < ${end}
          ${this.hospitalFilter("p", scope)}
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<{ day: string; amount: string }[]>`
        SELECT ${this.localDay(Prisma.sql`i."finalizedAt"`, scope.timeZone)} AS "day",
               SUM(i."total")::numeric(14,2)::text AS "amount"
        FROM "Invoice" i
        WHERE i."finalizedAt" IS NOT NULL
          AND i."status" NOT IN ('DRAFT', 'CANCELLED')
          AND i."finalizedAt" >= ${start} AND i."finalizedAt" < ${end}
          ${this.hospitalFilter("i", scope)}
        GROUP BY 1`,
      this.prisma.$queryRaw<{ amount: string | null; invoices: number }[]>`
        SELECT (COALESCE(SUM(i."total"), 0) - COALESCE(SUM(paid."amount"), 0))::numeric(14,2)::text AS "amount",
               COUNT(*)::int AS "invoices"
        FROM "Invoice" i
        LEFT JOIN (
          SELECT "invoiceId", SUM("amount") AS "amount" FROM "Payment"
          WHERE "status" = ${PaymentStatus.SUCCEEDED}::"PaymentStatus" GROUP BY "invoiceId"
        ) paid ON paid."invoiceId" = i."id"
        WHERE i."status" IN (${InvoiceStatus.FINALIZED}::"InvoiceStatus", ${InvoiceStatus.PARTIALLY_PAID}::"InvoiceStatus")
          ${this.hospitalFilter("i", scope)}`,
    ]);

    const byDay = new Map<string, { collected: Prisma.Decimal; invoiced: Prisma.Decimal; byMethod: Record<string, Prisma.Decimal> }>(
      range.days.map((date) => [date, { collected: new Prisma.Decimal(0), invoiced: new Prisma.Decimal(0), byMethod: {} }]),
    );
    let totalCollected = new Prisma.Decimal(0);
    let totalInvoiced = new Prisma.Decimal(0);
    for (const row of collected) {
      const day = byDay.get(row.day);
      if (!day) continue;
      const amount = new Prisma.Decimal(row.amount);
      day.collected = day.collected.add(amount);
      day.byMethod[row.method] = (day.byMethod[row.method] ?? new Prisma.Decimal(0)).add(amount);
      totalCollected = totalCollected.add(amount);
    }
    for (const row of invoiced) {
      const day = byDay.get(row.day);
      if (!day) continue;
      day.invoiced = day.invoiced.add(new Prisma.Decimal(row.amount));
      totalInvoiced = totalInvoiced.add(new Prisma.Decimal(row.amount));
    }
    const days: DailyRevenue[] = [...byDay.entries()].map(([date, d]) => ({
      date,
      collected: d.collected.toFixed(2),
      invoiced: d.invoiced.toFixed(2),
      byMethod: Object.fromEntries(Object.entries(d.byMethod).map(([method, value]) => [method, value.toFixed(2)])),
    }));
    return {
      scope: scope.kind,
      from: range.from,
      to: range.to,
      timezone: scope.timeZone,
      currency: CURRENCY,
      days,
      totals: { collected: totalCollected.toFixed(2), invoiced: totalInvoiced.toFixed(2) },
      outstanding: new Prisma.Decimal(outstanding[0]?.amount ?? "0").toFixed(2),
      outstandingInvoices: outstanding[0]?.invoices ?? 0,
    };
  }

  /** `GET /analytics/occupancy`: Hospital Admin and Nurse (own hospital). */
  async occupancy(caller: AuthenticatedUser): Promise<OccupancyView> {
    const scope = await this.scopeFor(caller);
    if (scope.kind === "PLATFORM") {
      throw new AppException(ApiErrorCode.FORBIDDEN_ROLE, "Bed occupancy is per hospital.", HttpStatus.FORBIDDEN);
    }
    return this.run(scope, async () => {
      const departments = await this.prisma.department.findMany({
        where: { hospitalId: scope.hospitalId!, rooms: { some: {} } },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          rooms: {
            orderBy: { roomNumber: "asc" },
            select: {
              id: true,
              roomNumber: true,
              type: true,
              beds: { orderBy: { bedNumber: "asc" }, select: { id: true, bedNumber: true, status: true } },
            },
          },
        },
      });
      const empty = (): BedCounts => ({ VACANT: 0, OCCUPIED: 0, MAINTENANCE: 0 });
      const total = empty();
      const result = departments.map((department) => {
        const counts = empty();
        for (const room of department.rooms) {
          for (const bed of room.beds) {
            counts[bed.status] += 1;
            total[bed.status] += 1;
          }
        }
        return { ...department, counts };
      });
      return { departments: result, counts: total };
    });
  }
}
