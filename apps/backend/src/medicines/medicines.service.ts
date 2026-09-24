import { HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ApiErrorCode, MedicineBatchStatus } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { AppException } from "../common/errors/app-exception";
import { PaginatedResult } from "../common/pagination/paginated-result";
import type { PaginationQueryDto } from "../common/pagination/pagination-query.dto";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import type { FindMedicinesQueryDto } from "./dto/find-medicines-query.dto";
import type { CreateMedicineDto } from "./dto/create-medicine.dto";
import type { UpdateMedicineDto } from "./dto/update-medicine.dto";
import type { ReceiveBatchDto } from "./dto/receive-batch.dto";
import type { FindExpiringQueryDto } from "./dto/find-expiring-query.dto";
import { StockService } from "./stock.service";
import { addDays, hospitalToday, parseDateOnly } from "./pharmacy-date.util";

export interface LowStockRow {
  id: string;
  name: string;
  genericName: string | null;
  form: string;
  unit: string;
  reorderLevel: number;
  lowStockAlertedAt: Date | null;
  availableQuantity: number;
}

/**
 * FR-PHARM-001/004/005 catalog, batch-inventory, and stock-level reads.
 * Phase 7 built the read-only search half (docs/11-DECISIONS.md D-017);
 * Phase 9 adds catalog/batch management and stock-level views.
 */
@Injectable()
export class MedicinesService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly stock: StockService,
  ) {}

  private requireHospitalId(caller: AuthenticatedUser): string {
    if (!caller.hospitalId) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "A hospital-scoped account is required for pharmacy access.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return caller.hospitalId;
  }

  private scoped<T>(
    caller: AuthenticatedUser,
    hospitalId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, fn);
  }

  /** The hospital's own local calendar date (pharmacy-date.util.ts). */
  async todayFor(hospitalId: string): Promise<Date> {
    const hospital = await this.prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { timezone: true },
    });
    return hospitalToday(hospital?.timezone ?? "UTC");
  }

  private async withAvailability<T extends { id: string }>(
    medicines: T[],
    today: Date,
  ): Promise<(T & { availableQuantity: number })[]> {
    if (medicines.length === 0) return [];
    const sums = await this.prisma.medicineBatch.groupBy({
      by: ["medicineId"],
      where: {
        medicineId: { in: medicines.map((m) => m.id) },
        status: MedicineBatchStatus.ACTIVE,
        expiryDate: { gte: today },
      },
      _sum: { quantityOnHand: true },
    });
    const byId = new Map(sums.map((s) => [s.medicineId, s._sum.quantityOnHand ?? 0]));
    return medicines.map((m) => ({ ...m, availableQuantity: byId.get(m.id) ?? 0 }));
  }

  async findAll(query: FindMedicinesQueryDto, caller: AuthenticatedUser) {
    if (!caller.hospitalId) return PaginatedResult.of([], 0, query.page, query.limit);
    const hospitalId = caller.hospitalId;
    const today = await this.todayFor(hospitalId);

    return this.scoped(caller, hospitalId, async () => {
      const where = {
        hospitalId,
        deletedAt: null,
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: "insensitive" as const } },
                { genericName: { contains: query.search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      };
      const [data, total] = await Promise.all([
        this.prisma.medicine.findMany({
          where,
          skip: query.skip,
          take: query.limit,
          orderBy: { name: "asc" },
        }),
        this.prisma.medicine.count({ where }),
      ]);
      return PaginatedResult.of(
        await this.withAvailability(data, today),
        total,
        query.page,
        query.limit,
      );
    });
  }

  async findOne(id: string, caller: AuthenticatedUser) {
    if (!caller.hospitalId) throw new NotFoundException("Medicine not found.");
    const hospitalId = caller.hospitalId;
    const today = await this.todayFor(hospitalId);
    return this.scoped(caller, hospitalId, async () => {
      const medicine = await this.prisma.medicine.findUnique({ where: { id } });
      if (!medicine || medicine.deletedAt) throw new NotFoundException("Medicine not found.");
      const [withQty] = await this.withAvailability([medicine], today);
      return withQty;
    });
  }

  async create(dto: CreateMedicineDto, caller: AuthenticatedUser) {
    const hospitalId = this.requireHospitalId(caller);
    // A brand-new medicine has zero stock, so it starts below any positive
    // reorder level — but that isn't a *crossing* (stock never was above
    // it), so the latch is set up front rather than alerting on creation.
    // The first batch receipt that lifts stock to the reorder level clears
    // it and arms the real low-stock alert (docs/11-DECISIONS.md D-022).
    const reorderLevel = dto.reorderLevel ?? 10;
    return this.scoped(caller, hospitalId, () =>
      this.prisma.medicine.create({
        data: {
          hospitalId,
          name: dto.name,
          genericName: dto.genericName,
          form: dto.form,
          manufacturer: dto.manufacturer,
          unit: dto.unit,
          reorderLevel,
          lowStockAlertedAt: reorderLevel > 0 ? new Date() : null,
        },
      }),
    );
  }

  async update(id: string, dto: UpdateMedicineDto, caller: AuthenticatedUser) {
    const hospitalId = this.requireHospitalId(caller);
    const today = await this.todayFor(hospitalId);

    await this.scoped(caller, hospitalId, () =>
      this.prisma.$transaction(async (tx) => {
        const locked = await this.stock.lockMedicines(tx, hospitalId, [id]);
        const existing = locked.length ? await tx.medicine.findUnique({ where: { id } }) : null;
        if (!existing || existing.deletedAt) throw new NotFoundException("Medicine not found.");

        await tx.medicine.update({
          where: { id },
          data: {
            name: dto.name,
            genericName: dto.genericName,
            form: dto.form,
            manufacturer: dto.manufacturer,
            unit: dto.unit,
            reorderLevel: dto.reorderLevel,
          },
        });

        if (dto.reorderLevel !== undefined && dto.reorderLevel !== existing.reorderLevel) {
          await this.stock.evaluateLowStock(tx, hospitalId, [id], today);
        }
      }),
    );
    return this.findOne(id, caller);
  }

  async listBatches(medicineId: string, query: PaginationQueryDto, caller: AuthenticatedUser) {
    const hospitalId = this.requireHospitalId(caller);
    return this.scoped(caller, hospitalId, async () => {
      const medicine = await this.prisma.medicine.findUnique({ where: { id: medicineId } });
      if (!medicine || medicine.deletedAt) throw new NotFoundException("Medicine not found.");
      const where = { medicineId };
      const [data, total] = await Promise.all([
        this.prisma.medicineBatch.findMany({
          where,
          // FEFO order — the order dispensing will consume them in.
          orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
          skip: query.skip,
          take: query.limit,
        }),
        this.prisma.medicineBatch.count({ where }),
      ]);
      return PaginatedResult.of(data, total, query.page, query.limit);
    });
  }

  async receiveBatch(medicineId: string, dto: ReceiveBatchDto, caller: AuthenticatedUser) {
    const hospitalId = this.requireHospitalId(caller);
    const today = await this.todayFor(hospitalId);
    const manufacturingDate = parseDateOnly(dto.manufacturingDate);
    const expiryDate = parseDateOnly(dto.expiryDate);

    if (manufacturingDate > today) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "manufacturingDate cannot be in the future.",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (expiryDate <= manufacturingDate) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "expiryDate must be after manufacturingDate.",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (expiryDate < today) {
      throw new AppException(
        ApiErrorCode.MEDICINE_EXPIRED,
        "This batch is already past its expiry date and cannot be received into dispensable stock.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    try {
      return await this.scoped(caller, hospitalId, () =>
        this.prisma.$transaction(async (tx) => {
          const locked = await this.stock.lockMedicines(tx, hospitalId, [medicineId]);
          const medicine = locked.length
            ? await tx.medicine.findUnique({ where: { id: medicineId } })
            : null;
          if (!medicine || medicine.deletedAt) throw new NotFoundException("Medicine not found.");

          const batch = await tx.medicineBatch.create({
            data: {
              hospitalId,
              medicineId,
              batchNumber: dto.batchNumber,
              manufacturingDate,
              expiryDate,
              quantityOnHand: dto.quantity,
              unitCost: dto.unitCost,
              mrp: dto.mrp,
            },
          });
          // A receipt can only raise stock — this clears the latch if it
          // lifts stock back to the reorder level, re-arming the alert.
          await this.stock.evaluateLowStock(tx, hospitalId, [medicineId], today);
          return batch;
        }),
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppException(
          ApiErrorCode.VALIDATION_ERROR,
          `Batch "${dto.batchNumber}" has already been received for this medicine.`,
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }

  /** FR-PHARM-004 — a live read of current stock against each reorder
   * level. Pure read: it never touches the alert latch, so viewing the list
   * can't raise (or re-raise) an alert. */
  async findLowStock(query: PaginationQueryDto, caller: AuthenticatedUser) {
    const hospitalId = this.requireHospitalId(caller);
    const today = await this.todayFor(hospitalId);

    // Raw SQL (a filtered SUM + HAVING across a join) bypasses the
    // tenant-scoping extension, so hospitalId is bound explicitly.
    const lowStockCte = Prisma.sql`
      WITH stock AS (
        SELECT m."id", m."name", m."genericName", m."form"::text AS "form", m."unit",
               m."reorderLevel", m."lowStockAlertedAt",
               COALESCE(SUM(b."quantityOnHand") FILTER (
                 WHERE b."status" = 'ACTIVE' AND b."expiryDate" >= ${today}::date
               ), 0)::int AS "availableQuantity"
        FROM "Medicine" m
        LEFT JOIN "MedicineBatch" b ON b."medicineId" = m."id"
        WHERE m."hospitalId" = ${hospitalId} AND m."deletedAt" IS NULL
        GROUP BY m."id"
      )`;

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<LowStockRow[]>`
        ${lowStockCte}
        SELECT * FROM stock WHERE "availableQuantity" < "reorderLevel"
        ORDER BY "name" ASC, "id" ASC
        LIMIT ${query.limit} OFFSET ${query.skip}`,
      this.prisma.$queryRaw<{ total: number }[]>`
        ${lowStockCte}
        SELECT COUNT(*)::int AS "total" FROM stock WHERE "availableQuantity" < "reorderLevel"`,
    ]);
    return PaginatedResult.of(rows, countRows[0]?.total ?? 0, query.page, query.limit);
  }

  /** FR-PHARM-005's window as an on-demand view: dispensable batches
   * (ACTIVE, stock remaining) expiring within the next `days` days,
   * soonest first. */
  async findExpiring(query: FindExpiringQueryDto, caller: AuthenticatedUser) {
    const hospitalId = this.requireHospitalId(caller);
    const today = await this.todayFor(hospitalId);
    return this.scoped(caller, hospitalId, async () => {
      const where = {
        status: MedicineBatchStatus.ACTIVE,
        quantityOnHand: { gt: 0 },
        expiryDate: { gte: today, lte: addDays(today, query.days) },
        medicine: { deletedAt: null },
      };
      const [data, total] = await Promise.all([
        this.prisma.medicineBatch.findMany({
          where,
          include: { medicine: { select: { id: true, name: true, unit: true } } },
          orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
          skip: query.skip,
          take: query.limit,
        }),
        this.prisma.medicineBatch.count({ where }),
      ]);
      return PaginatedResult.of(data, total, query.page, query.limit);
    });
  }
}
