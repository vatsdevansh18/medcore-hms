import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  MedicineBatchStatus,
  NotificationChannel,
  NotificationType,
  UserRole,
  UserStatus,
} from "@medcore/types";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";

/** The subset of the (extended) client both the root client and an
 * interactive-transaction client expose — lets every helper here run
 * either inside the caller's `$transaction` or standalone. */
export type PharmacyDb = Pick<
  ExtendedPrismaClient,
  "medicine" | "medicineBatch" | "user" | "notification" | "$queryRaw"
>;

/** docs/07-RBAC-MATRIX.md §3.7 "Receive low-stock/expiry alerts" row. */
export const STOCK_ALERT_RECIPIENT_ROLES: UserRole[] = [
  UserRole.PHARMACIST,
  UserRole.HOSPITAL_ADMIN,
];

/**
 * Stock-level rules shared by receiving, dispensing, catalog edits, and the
 * nightly expiry scan, so "available stock" means the same thing everywhere.
 */
@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  /**
   * Row-locks the given `Medicine` rows for the rest of the caller's
   * transaction. Every write that changes a medicine's available stock
   * (receive, dispense, quarantine) or its threshold (reorder-level edit)
   * takes this lock first, which serialises them per medicine: two
   * concurrent dispenses can never both read the same batch quantity, and a
   * low-stock evaluation always sees a settled stock figure.
   *
   * Raw SQL bypasses the tenant-scoping extension, so `hospitalId` is
   * filtered explicitly here. Ids are locked in sorted order to keep
   * multi-medicine transactions deadlock-free. Returns the ids actually
   * locked (a missing or other-tenant id is simply absent).
   */
  async lockMedicines(
    db: PharmacyDb,
    hospitalId: string,
    medicineIds: string[],
  ): Promise<string[]> {
    const ids = [...new Set(medicineIds)].sort();
    if (ids.length === 0) return [];
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Medicine"
      WHERE "id" IN (${Prisma.join(ids)}) AND "hospitalId" = ${hospitalId}
      ORDER BY "id"
      FOR UPDATE`;
    return rows.map((r) => r.id);
  }

  /** Dispensable stock: ACTIVE batches whose expiry date hasn't passed yet
   * in the hospital's local calendar. An ACTIVE-but-expired batch (expired
   * since the last nightly scan) is excluded even before it's quarantined
   * — FR-PHARM-003 "can never be selected for dispensing". */
  eligibleBatchWhere(medicineId: string, today: Date): Prisma.MedicineBatchWhereInput {
    return {
      medicineId,
      status: MedicineBatchStatus.ACTIVE,
      expiryDate: { gte: today },
      quantityOnHand: { gt: 0 },
    };
  }

  async availableQuantity(db: PharmacyDb, medicineId: string, today: Date): Promise<number> {
    const agg = await db.medicineBatch.aggregate({
      where: this.eligibleBatchWhere(medicineId, today),
      _sum: { quantityOnHand: true },
    });
    return agg._sum.quantityOnHand ?? 0;
  }

  /**
   * FR-PHARM-004, "fires exactly once per crossing of the reorder threshold,
   * not on every subsequent read" (docs/10-TESTING-STRATEGY.md §4).
   * `Medicine.lowStockAlertedAt` is a latch (docs/11-DECISIONS.md D-022):
   * the first evaluation that finds stock below the reorder level claims it
   * with a conditional update and fans out the alert; later evaluations
   * while still low find it already set and stay silent; the first
   * evaluation that finds stock back at/above the level clears it, re-arming
   * the next crossing. The conditional update itself makes the claim
   * race-safe even without the medicine row lock.
   *
   * Callers must hold `lockMedicines` for these ids when calling from a
   * stock-changing transaction.
   */
  async evaluateLowStock(
    db: PharmacyDb,
    hospitalId: string,
    medicineIds: string[],
    today: Date,
  ): Promise<string[]> {
    const alerted: string[] = [];
    for (const medicineId of [...new Set(medicineIds)]) {
      const medicine = await db.medicine.findUnique({ where: { id: medicineId } });
      if (!medicine || medicine.deletedAt) continue;

      const available = await this.availableQuantity(db, medicineId, today);

      if (available < medicine.reorderLevel) {
        const claim = await db.medicine.updateMany({
          where: { id: medicineId, lowStockAlertedAt: null },
          data: { lowStockAlertedAt: new Date() },
        });
        if (claim.count === 1) {
          await this.notifyLowStock(db, hospitalId, medicine, available);
          alerted.push(medicineId);
        }
      } else if (medicine.lowStockAlertedAt) {
        await db.medicine.updateMany({
          where: { id: medicineId, lowStockAlertedAt: { not: null } },
          data: { lowStockAlertedAt: null },
        });
      }
    }
    return alerted;
  }

  /** Active pharmacy-alert recipients for a hospital. `select: { id }` only
   * — never returns any other `User` column (CLAUDE.md SAFE_USER_SELECT rule). */
  async alertRecipientIds(db: PharmacyDb): Promise<string[]> {
    const users = await db.user.findMany({
      where: {
        role: { in: STOCK_ALERT_RECIPIENT_ROLES },
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /**
   * Persists one `Notification` row per recipient — the same "real row now,
   * multi-channel dispatch in Phase 11" scoping as FR-LAB-005
   * (docs/11-DECISIONS.md D-020). Written inside the caller's transaction,
   * so an alert exists if and only if the latch was claimed.
   */
  private async notifyLowStock(
    db: PharmacyDb,
    hospitalId: string,
    medicine: { id: string; name: string; reorderLevel: number; unit: string },
    available: number,
  ): Promise<void> {
    const recipients = await this.alertRecipientIds(db);
    if (recipients.length === 0) {
      this.logger.warn(
        `Low-stock alert for medicine ${medicine.id} has no active recipients in hospital ${hospitalId}.`,
      );
      return;
    }
    await db.notification.createMany({
      data: recipients.map((recipientUserId) => ({
        hospitalId,
        recipientUserId,
        type: NotificationType.LOW_STOCK_ALERT,
        title: `Low stock: ${medicine.name}`,
        body:
          `${medicine.name} is below its reorder level: ${available} ${medicine.unit} available, ` +
          `reorder level ${medicine.reorderLevel}.`,
        channels: [NotificationChannel.IN_APP],
        relatedEntityType: "Medicine",
        relatedEntityId: medicine.id,
      })),
    });
  }
}
