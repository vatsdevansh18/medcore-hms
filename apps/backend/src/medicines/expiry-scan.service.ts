import { Inject, Injectable, Logger } from "@nestjs/common";
import { MedicineBatchStatus, NotificationType } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { StockService } from "./stock.service";
import { addDays, hospitalToday, toDateKey } from "./pharmacy-date.util";
import { NotificationsService } from "../notifications/notifications.service";

export interface ExpiryDigestEntry {
  medicineName: string;
  batchNumber: string;
  expiryDate: string;
  quantityOnHand: number;
}

/** FR-PHARM-005 — "batches expiring within 30 days". */
export const EXPIRY_DIGEST_WINDOW_DAYS = 30;

/** Caps the digest body; the full list is always in `GET /medicines/expiring`. */
const DIGEST_MAX_LINES = 50;

export interface HospitalScanResult {
  hospitalId: string;
  scanDate: string;
  quarantinedBatchIds: string[];
  lowStockAlertedMedicineIds: string[];
  expiringBatchCount: number;
  digestNotificationsCreated: number;
}

/**
 * The `medicine-expiry-scan` nightly job's work (docs/03-ARCHITECTURE.md
 * §12), kept out of the BullMQ processor so it can be exercised directly.
 * Each hospital is processed under its own TenantContext, so every query is
 * tenant-scoped exactly as a request would be; the actor is `null`
 * (system) in the audit trail.
 *
 * Idempotent and date-scoped: re-running on the same day quarantines
 * nothing new and sends no second digest, so BullMQ retries and a missed
 * night caught up later are both safe.
 */
@Injectable()
export class ExpiryScanService {
  private readonly logger = new Logger(ExpiryScanService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly stock: StockService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Scans every hospital (or just `onlyHospitalIds`). One hospital failing
   * doesn't stop the others; the run still throws afterwards so BullMQ
   * records the failure and retries. */
  async runScan(now: Date = new Date(), onlyHospitalIds?: string[]): Promise<HospitalScanResult[]> {
    const hospitals = await this.prisma.hospital.findMany({
      where: onlyHospitalIds ? { id: { in: onlyHospitalIds } } : undefined,
      select: { id: true, name: true, timezone: true },
      orderBy: { id: "asc" },
    });

    const results: HospitalScanResult[] = [];
    const failures: string[] = [];
    for (const hospital of hospitals) {
      try {
        results.push(await this.scanHospital(hospital, now));
      } catch (err) {
        failures.push(hospital.id);
        this.logger.error(
          `Expiry scan failed for hospital ${hospital.id}: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }
    // Digests and any low-stock alerts are committed; hand them to delivery.
    this.notifications.publish();
    if (failures.length > 0) {
      throw new Error(
        `Expiry scan failed for ${failures.length} hospital(s): ${failures.join(", ")}`,
      );
    }
    return results;
  }

  private async scanHospital(
    hospital: { id: string; name: string; timezone: string },
    now: Date,
  ): Promise<HospitalScanResult> {
    const hospitalId = hospital.id;
    const today = hospitalToday(hospital.timezone, now);
    const scanDate = toDateKey(today);

    return TenantContext.run({ hospitalId, userId: null, bypassTenancy: false }, async () => {
      // 1. FR-PHARM-003: quarantine every still-ACTIVE batch whose expiry
      //    date has passed, one medicine at a time under that medicine's row
      //    lock (so it can't interleave with a dispense), then re-evaluate
      //    low stock, since losing an expired batch can itself be a
      //    reorder-threshold crossing.
      const expired = await this.prisma.medicineBatch.findMany({
        where: { status: MedicineBatchStatus.ACTIVE, expiryDate: { lt: today } },
        select: { id: true, medicineId: true },
      });
      const expiredByMedicine = new Map<string, string[]>();
      for (const b of expired) {
        expiredByMedicine.set(b.medicineId, [...(expiredByMedicine.get(b.medicineId) ?? []), b.id]);
      }

      const quarantinedBatchIds: string[] = [];
      const lowStockAlertedMedicineIds: string[] = [];
      for (const [medicineId, batchIds] of expiredByMedicine) {
        await this.prisma.$transaction(async (tx) => {
          await this.stock.lockMedicines(tx, hospitalId, [medicineId]);
          // Re-checked under the lock: only batches still ACTIVE are flipped.
          const toQuarantine = await tx.medicineBatch.findMany({
            where: { id: { in: batchIds }, status: MedicineBatchStatus.ACTIVE },
            select: { id: true },
          });
          for (const { id } of toQuarantine) {
            // Per-row update rather than updateMany, so each batch gets its
            // own before/after entry in the audit trail.
            await tx.medicineBatch.update({
              where: { id },
              data: { status: MedicineBatchStatus.QUARANTINED },
            });
            quarantinedBatchIds.push(id);
          }
          lowStockAlertedMedicineIds.push(
            ...(await this.stock.evaluateLowStock(tx, hospitalId, [medicineId], today)),
          );
        });
      }

      // 2. FR-PHARM-005: expiring-soon digest to pharmacy staff.
      const expiring = await this.prisma.medicineBatch.findMany({
        where: {
          status: MedicineBatchStatus.ACTIVE,
          quantityOnHand: { gt: 0 },
          expiryDate: { gte: today, lte: addDays(today, EXPIRY_DIGEST_WINDOW_DAYS) },
          medicine: { deletedAt: null },
        },
        include: { medicine: { select: { name: true } } },
        orderBy: [{ expiryDate: "asc" }, { id: "asc" }],
      });

      let digestNotificationsCreated = 0;
      if (expiring.length > 0 || quarantinedBatchIds.length > 0) {
        digestNotificationsCreated = await this.sendDigest(
          hospital,
          scanDate,
          expiring.map((b) => ({
            medicineName: b.medicine.name,
            batchNumber: b.batchNumber,
            expiryDate: toDateKey(b.expiryDate),
            quantityOnHand: b.quantityOnHand,
          })),
          quarantinedBatchIds.length,
        );
      }

      this.logger.log(
        `Expiry scan ${scanDate} hospital ${hospitalId}: quarantined ${quarantinedBatchIds.length}, ` +
          `expiring ${expiring.length}, low-stock alerts ${lowStockAlertedMedicineIds.length}, ` +
          `digests ${digestNotificationsCreated}.`,
      );

      return {
        hospitalId,
        scanDate,
        quarantinedBatchIds,
        lowStockAlertedMedicineIds,
        expiringBatchCount: expiring.length,
        digestNotificationsCreated,
      };
    });
  }

  /** One digest per recipient per hospital-local day (brief §7.6 hint;
   * Email + In-app per the trigger table). The hospital and date form the
   * dedupe key, so a retried or repeated run the same day creates nothing
   * new, even if two runs race. Runs inside the hospital's TenantContext;
   * `runScan` publishes once every hospital is done. */
  private async sendDigest(
    hospital: { id: string; name: string },
    scanDate: string,
    entries: ExpiryDigestEntry[],
    quarantinedCount: number,
  ): Promise<number> {
    const recipientIds = await this.stock.alertRecipientIds(this.prisma);
    if (recipientIds.length === 0) return 0;

    const lines = entries
      .slice(0, DIGEST_MAX_LINES)
      .map(
        (e) =>
          `${e.medicineName} (batch ${e.batchNumber}): ${e.quantityOnHand} left, expires ${e.expiryDate}`,
      );
    const body = [
      `${hospital.name}: ${entries.length} batch(es) expire within ${EXPIRY_DIGEST_WINDOW_DAYS} days.`,
      ...(quarantinedCount > 0
        ? [`${quarantinedCount} expired batch(es) were quarantined today.`]
        : []),
      ...lines,
      ...(entries.length > DIGEST_MAX_LINES
        ? [`...and ${entries.length - DIGEST_MAX_LINES} more.`]
        : []),
    ].join("\n");

    return this.notifications.record(this.prisma, {
      type: NotificationType.MEDICINE_EXPIRY_DIGEST,
      hospitalId: hospital.id,
      recipientUserIds: recipientIds,
      title: `Medicine expiry digest: ${scanDate}`,
      body,
      relatedEntityType: "MedicineExpiryDigest",
      relatedEntityId: scanDate,
      dedupeKey: `${NotificationType.MEDICINE_EXPIRY_DIGEST}:${hospital.id}:${scanDate}`,
    });
  }
}
