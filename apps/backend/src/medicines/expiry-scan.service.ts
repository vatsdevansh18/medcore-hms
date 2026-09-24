import { Inject, Injectable, Logger } from "@nestjs/common";
import { MedicineBatchStatus, NotificationChannel, NotificationType } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { StockService } from "./stock.service";
import { addDays, hospitalToday, toDateKey } from "./pharmacy-date.util";
import {
  EXPIRY_DIGEST_DELIVERY_PORT,
  type ExpiryDigestDeliveryPort,
  type ExpiryDigestEntry,
} from "./expiry-digest-delivery.stub";

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
    @Inject(EXPIRY_DIGEST_DELIVERY_PORT) private readonly delivery: ExpiryDigestDeliveryPort,
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

  /** One digest per recipient per hospital-local day. The date is the
   * idempotency key (`relatedEntityId`), so a retried or repeated run the
   * same day skips anyone already sent that day's digest. Runs inside the
   * hospital's TenantContext. */
  private async sendDigest(
    hospital: { id: string; name: string },
    scanDate: string,
    entries: ExpiryDigestEntry[],
    quarantinedCount: number,
  ): Promise<number> {
    const recipientIds = await this.stock.alertRecipientIds(this.prisma);
    if (recipientIds.length === 0) return 0;

    const alreadySent = await this.prisma.notification.findMany({
      where: {
        type: NotificationType.MEDICINE_EXPIRY_DIGEST,
        relatedEntityId: scanDate,
        recipientUserId: { in: recipientIds },
      },
      select: { recipientUserId: true },
    });
    const sent = new Set(alreadySent.map((n) => n.recipientUserId));
    const pending = recipientIds.filter((id) => !sent.has(id));
    if (pending.length === 0) return 0;

    const lines = entries
      .slice(0, DIGEST_MAX_LINES)
      .map(
        (e) =>
          `${e.medicineName} (batch ${e.batchNumber}): ${e.quantityOnHand} left, expires ${e.expiryDate}`,
      );
    const body = [
      `${entries.length} batch(es) expire within ${EXPIRY_DIGEST_WINDOW_DAYS} days.`,
      ...(quarantinedCount > 0
        ? [`${quarantinedCount} expired batch(es) were quarantined today.`]
        : []),
      ...lines,
      ...(entries.length > DIGEST_MAX_LINES
        ? [`...and ${entries.length - DIGEST_MAX_LINES} more.`]
        : []),
    ].join("\n");

    await this.prisma.notification.createMany({
      data: pending.map((recipientUserId) => ({
        hospitalId: hospital.id,
        recipientUserId,
        type: NotificationType.MEDICINE_EXPIRY_DIGEST,
        title: `Medicine expiry digest: ${scanDate}`,
        body,
        channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
        relatedEntityType: "MedicineExpiryDigest",
        relatedEntityId: scanDate,
      })),
    });

    const recipients = await this.prisma.user.findMany({
      where: { id: { in: pending } },
      select: { email: true },
    });
    await this.delivery.sendExpiryDigest({
      hospitalName: hospital.name,
      recipientEmails: recipients.map((r) => r.email),
      digestDate: scanDate,
      entries,
      quarantinedCount,
    });
    return pending.length;
  }
}
