import { HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  ApiErrorCode,
  InvoiceItemSourceType,
  MedicineBatchStatus,
  PrescriptionStatus,
} from "@medcore/types";
import { toPrescriptionView } from "../prescriptions/prescription-view";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { AppException } from "../common/errors/app-exception";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import type { DispenseDto, DispenseItemDto } from "./dto/dispense.dto";
import { StockService } from "./stock.service";
import { MedicinesService } from "./medicines.service";
import { ChargesService, type ChargeInput } from "../billing/charges.service";
import { NotificationsService } from "../notifications/notifications.service";

interface BatchRow {
  id: string;
  batchNumber: string;
  expiryDate: Date;
  quantityOnHand: number;
  status: string;
  mrp: Prisma.Decimal;
}

interface Allocation {
  prescriptionItemId: string;
  batchId: string;
  quantity: number;
}

const DISPENSED_PRESCRIPTION_INCLUDE = {
  items: {
    include: {
      medicine: true,
      dispenseRecords: {
        include: { medicineBatch: { select: { id: true, batchNumber: true, expiryDate: true } } },
        orderBy: { dispensedAt: "asc" as const },
      },
    },
  },
} as const;

/**
 * FR-PHARM-002/003 — dispensing against a prescription.
 *
 * Batch selection is FEFO (earliest-expiring eligible batch first,
 * docs/11-DECISIONS.md D-004), splitting one line across several batches
 * when the first can't cover it. "Eligible" means ACTIVE, not past its
 * expiry date in the hospital's local calendar, and with stock left — so an
 * expired batch the nightly scan hasn't quarantined yet is still never
 * selected. The whole request is one transaction: every line is validated
 * and allocated before anything is written, and any failure leaves stock,
 * dispense records, and the prescription untouched.
 */
@Injectable()
export class DispensingService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly stock: StockService,
    private readonly medicines: MedicinesService,
    private readonly charges: ChargesService,
    private readonly notifications: NotificationsService,
  ) {}

  async dispense(prescriptionId: string, dto: DispenseDto, caller: AuthenticatedUser) {
    if (!caller.hospitalId) throw new NotFoundException("Prescription not found.");
    const hospitalId = caller.hospitalId;
    const today = await this.medicines.todayFor(hospitalId);

    const requestedItemIds = dto.items.map((i) => i.prescriptionItemId);
    if (new Set(requestedItemIds).size !== requestedItemIds.length) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "Each prescription item may appear at most once per dispense request.",
        HttpStatus.BAD_REQUEST,
      );
    }

    await TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, () =>
      this.prisma.$transaction(async (tx) => {
        // Lock order (prescription, then medicines sorted by id) is the
        // same for every dispense, so concurrent dispenses serialise
        // instead of deadlocking. The prescription lock stops two
        // concurrent requests both dispensing the same outstanding quantity.
        const lockedPrescription = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Prescription"
          WHERE "id" = ${prescriptionId} AND "hospitalId" = ${hospitalId}
          FOR UPDATE`;
        if (lockedPrescription.length === 0) throw new NotFoundException("Prescription not found.");

        const prescription = await tx.prescription.findUniqueOrThrow({
          where: { id: prescriptionId },
          include: {
            items: { include: { medicine: { select: { name: true } } } },
            medicalRecord: { select: { appointmentId: true } },
          },
        });
        if (
          prescription.status === PrescriptionStatus.CANCELLED ||
          prescription.status === PrescriptionStatus.DISPENSED
        ) {
          throw new AppException(
            ApiErrorCode.VALIDATION_ERROR,
            `Cannot dispense against a prescription that is ${prescription.status}.`,
            HttpStatus.CONFLICT,
          );
        }

        const itemsById = new Map(prescription.items.map((i) => [i.id, i]));
        for (const line of dto.items) {
          const item = itemsById.get(line.prescriptionItemId);
          if (!item) {
            throw new AppException(
              ApiErrorCode.VALIDATION_ERROR,
              "prescriptionItemId does not belong to this prescription.",
              HttpStatus.BAD_REQUEST,
            );
          }
          const outstanding = item.quantityPrescribed - item.quantityDispensed;
          if (line.quantity > outstanding) {
            throw new AppException(
              ApiErrorCode.VALIDATION_ERROR,
              `Cannot dispense ${line.quantity}: only ${outstanding} remain outstanding on this item.`,
              HttpStatus.BAD_REQUEST,
              { prescriptionItemId: item.id, outstanding },
            );
          }
        }

        const medicineIds = dto.items.map(
          (line) => itemsById.get(line.prescriptionItemId)!.medicineId,
        );
        await this.stock.lockMedicines(tx, hospitalId, medicineIds);

        // Allocate every line against an in-memory view of each medicine's
        // batches, so two lines for the same medicine can't both claim the
        // same units.
        const batchesByMedicine = new Map<string, BatchRow[]>();
        const allocations: Allocation[] = [];
        for (const line of dto.items) {
          const medicineId = itemsById.get(line.prescriptionItemId)!.medicineId;
          let batches = batchesByMedicine.get(medicineId);
          if (!batches) {
            batches = await tx.medicineBatch.findMany({
              where: { medicineId },
              orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
              select: {
                id: true,
                batchNumber: true,
                expiryDate: true,
                quantityOnHand: true,
                status: true,
                mrp: true,
              },
            });
            batchesByMedicine.set(medicineId, batches);
          }
          allocations.push(...this.allocate(line, medicineId, batches, today));
        }

        const batchById = new Map([...batchesByMedicine.values()].flat().map((b) => [b.id, b]));
        const pharmacyCharges: ChargeInput[] = [];
        for (const a of allocations) {
          const batch = await tx.medicineBatch.update({
            where: { id: a.batchId },
            data: { quantityOnHand: { decrement: a.quantity } },
          });
          if (batch.quantityOnHand === 0) {
            await tx.medicineBatch.update({
              where: { id: a.batchId },
              data: { status: MedicineBatchStatus.DEPLETED },
            });
          }
          const record = await tx.dispenseRecord.create({
            data: {
              prescriptionItemId: a.prescriptionItemId,
              medicineBatchId: a.batchId,
              quantity: a.quantity,
              dispensedBy: caller.sub,
            },
          });
          // FR-BILL-001: billed per dispense record at the dispensed batch's MRP.
          const drawnFrom = batchById.get(a.batchId)!;
          pharmacyCharges.push({
            sourceType: InvoiceItemSourceType.PHARMACY,
            sourceId: record.id,
            description: `${itemsById.get(a.prescriptionItemId)!.medicine.name} (batch ${drawnFrom.batchNumber})`,
            quantity: a.quantity,
            unitPrice: drawnFrom.mrp,
          });
        }

        for (const line of dto.items) {
          await tx.prescriptionItem.update({
            where: { id: line.prescriptionItemId },
            data: { quantityDispensed: { increment: line.quantity } },
          });
        }

        const dispensedNow = new Map(dto.items.map((l) => [l.prescriptionItemId, l.quantity]));
        const fullyDispensed = prescription.items.every(
          (i) => i.quantityDispensed + (dispensedNow.get(i.id) ?? 0) >= i.quantityPrescribed,
        );
        await tx.prescription.update({
          where: { id: prescription.id },
          data: {
            status: fullyDispensed
              ? PrescriptionStatus.DISPENSED
              : PrescriptionStatus.PARTIALLY_DISPENSED,
          },
        });

        await this.stock.evaluateLowStock(tx, hospitalId, medicineIds, today);

        // Lock order continues prescription -> medicines -> appointment ->
        // invoice. If the visit's invoice is already finalized, this opens a
        // supplementary draft (docs/11-DECISIONS.md D-027).
        await this.charges.addCharges(
          tx,
          hospitalId,
          prescription.medicalRecord.appointmentId,
          pharmacyCharges,
        );
      }),
    );
    // Any low-stock alert raised above is committed now.
    this.notifications.publish();

    const dispensed = await TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, () =>
      this.prisma.prescription.findUniqueOrThrow({
        where: { id: prescriptionId },
        include: DISPENSED_PRESCRIPTION_INCLUDE,
      }),
    );
    return toPrescriptionView(dispensed);
  }

  private isEligible(batch: BatchRow, today: Date): boolean {
    return (
      batch.status === MedicineBatchStatus.ACTIVE &&
      batch.expiryDate >= today &&
      batch.quantityOnHand > 0
    );
  }

  private isExpiredOrQuarantined(batch: BatchRow, today: Date): boolean {
    return batch.status === MedicineBatchStatus.QUARANTINED || batch.expiryDate < today;
  }

  /** Allocates one line, decrementing the in-memory `batches` view. Throws
   * (writing nothing) if the line can't be fully covered. */
  private allocate(
    line: DispenseItemDto,
    medicineId: string,
    batches: BatchRow[],
    today: Date,
  ): Allocation[] {
    if (line.batchId) {
      const chosen = batches.find((b) => b.id === line.batchId);
      if (!chosen) {
        throw new AppException(
          ApiErrorCode.VALIDATION_ERROR,
          "batchId is not a batch of the prescribed medicine.",
          HttpStatus.BAD_REQUEST,
        );
      }
      if (this.isExpiredOrQuarantined(chosen, today)) {
        throw new AppException(
          ApiErrorCode.MEDICINE_EXPIRED,
          `Batch ${chosen.batchNumber} is expired or quarantined and cannot be dispensed.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
          { batchId: chosen.id },
        );
      }
      if (chosen.quantityOnHand < line.quantity) {
        throw new AppException(
          ApiErrorCode.INSUFFICIENT_STOCK,
          `Batch ${chosen.batchNumber} has only ${chosen.quantityOnHand} left; ${line.quantity} requested.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
          { batchId: chosen.id, available: chosen.quantityOnHand, requested: line.quantity },
        );
      }
      const fefoBatch = batches.find((b) => this.isEligible(b, today));
      if (fefoBatch && fefoBatch.id !== chosen.id) {
        throw new AppException(
          ApiErrorCode.VALIDATION_ERROR,
          `Batch ${fefoBatch.batchNumber} expires first and must be dispensed before batch ${chosen.batchNumber}.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
          { expectedBatchId: fefoBatch.id },
        );
      }
      chosen.quantityOnHand -= line.quantity;
      return [
        {
          prescriptionItemId: line.prescriptionItemId,
          batchId: chosen.id,
          quantity: line.quantity,
        },
      ];
    }

    const eligible = batches.filter((b) => this.isEligible(b, today));
    const available = eligible.reduce((sum, b) => sum + b.quantityOnHand, 0);
    if (available < line.quantity) {
      // Distinguish "the only stock left is expired/quarantined" from
      // "nothing left at all" — both refuse, never fall back to ineligible
      // stock, but the pharmacist's next step differs.
      const blockedByExpiry = batches.some(
        (b) => b.quantityOnHand > 0 && this.isExpiredOrQuarantined(b, today),
      );
      const details = { medicineId, available, requested: line.quantity };
      if (blockedByExpiry) {
        throw new AppException(
          ApiErrorCode.MEDICINE_EXPIRED,
          "Not enough unexpired stock to dispense this item; the remaining stock is expired or quarantined.",
          HttpStatus.UNPROCESSABLE_ENTITY,
          details,
        );
      }
      throw new AppException(
        ApiErrorCode.INSUFFICIENT_STOCK,
        `Not enough stock to dispense this item: ${available} available, ${line.quantity} requested.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        details,
      );
    }

    const result: Allocation[] = [];
    let remaining = line.quantity;
    for (const batch of eligible) {
      if (remaining === 0) break;
      const take = Math.min(batch.quantityOnHand, remaining);
      batch.quantityOnHand -= take;
      remaining -= take;
      result.push({
        prescriptionItemId: line.prescriptionItemId,
        batchId: batch.id,
        quantity: take,
      });
    }
    return result;
  }
}
