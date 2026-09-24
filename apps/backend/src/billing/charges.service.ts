import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { InvoiceStatus, type InvoiceItemSourceType } from "@medcore/types";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";

/** The subset of the extended client both the root client and an
 * interactive-transaction client expose, so every helper here runs inside
 * the caller's own `$transaction` (same pattern as pharmacy's `PharmacyDb`). */
export type BillingDb = Pick<
  ExtendedPrismaClient,
  "invoice" | "invoiceItem" | "payment" | "appointment" | "notification" | "$queryRaw"
>;

export interface ChargeInput {
  sourceType: InvoiceItemSourceType;
  /** The clinical record the charge came from (appointment, lab order item,
   * dispense record); null for a manually entered line. */
  sourceId: string | null;
  description: string;
  quantity: number;
  unitPrice: Prisma.Decimal | number | string;
}

/**
 * FR-BILL-001 — invoice line items accumulate automatically as charges are
 * incurred. Every charge, automatic or manual, goes through here so that:
 *
 * - `lineTotal` is always computed server-side (`quantity × unitPrice`), and
 *   the invoice's `subtotal`/`total` are recomputed from the items in the
 *   same transaction (FR-BILL-003). The database re-verifies both at commit
 *   (CHECK + deferred constraint trigger, migration
 *   `20260924120000_billing_integrity`).
 * - A charge lands on the appointment's current DRAFT invoice, creating one
 *   if none is open. If the visit's invoice has already been finalized, a
 *   supplementary DRAFT invoice is opened rather than editing a finalized
 *   one or losing the charge (docs/11-DECISIONS.md D-027).
 *
 * Lock order: `Appointment` row, then `Invoice` row. Every caller follows
 * it, so concurrent charges and finalizations serialise instead of
 * deadlocking or opening two DRAFT invoices for one visit.
 */
@Injectable()
export class ChargesService {
  /** Raw SQL bypasses the tenant-scoping extension: hospitalId is always bound
   * explicitly (CLAUDE.md). Returns false if the appointment isn't in this
   * hospital. */
  async lockAppointment(db: BillingDb, hospitalId: string, appointmentId: string): Promise<boolean> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Appointment"
      WHERE "id" = ${appointmentId} AND "hospitalId" = ${hospitalId}
      FOR UPDATE`;
    return rows.length === 1;
  }

  /** Locks an invoice row for a status/balance-changing operation. Returns
   * false if it doesn't exist in this hospital. */
  async lockInvoice(db: BillingDb, hospitalId: string, invoiceId: string): Promise<boolean> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Invoice"
      WHERE "id" = ${invoiceId} AND "hospitalId" = ${hospitalId}
      FOR UPDATE`;
    return rows.length === 1;
  }

  /** The appointment's open DRAFT invoice, created if there is none. Takes
   * the Appointment lock first (see class doc). */
  async getOrCreateDraftInvoice(db: BillingDb, hospitalId: string, appointmentId: string): Promise<string> {
    if (!(await this.lockAppointment(db, hospitalId, appointmentId))) {
      throw new NotFoundException("Appointment not found.");
    }
    // The re-check under FOR UPDATE matters: if a concurrent finalize held
    // this row, Postgres re-evaluates `status = 'DRAFT'` once it's released
    // and the now-finalized invoice drops out, so a new draft is opened.
    const drafts = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Invoice"
      WHERE "appointmentId" = ${appointmentId} AND "hospitalId" = ${hospitalId} AND "status" = 'DRAFT'
      ORDER BY "createdAt" DESC
      LIMIT 1
      FOR UPDATE`;
    if (drafts.length > 0) return drafts[0].id;

    const appointment = await db.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      select: { patientId: true },
    });
    const invoice = await db.invoice.create({
      data: { hospitalId, appointmentId, patientId: appointment.patientId, status: InvoiceStatus.DRAFT },
    });
    return invoice.id;
  }

  /** Adds charges to the appointment's DRAFT invoice (see class doc).
   * Returns the invoice id they landed on. */
  async addCharges(
    db: BillingDb,
    hospitalId: string,
    appointmentId: string,
    charges: ChargeInput[],
  ): Promise<string | null> {
    if (charges.length === 0) return null;
    const invoiceId = await this.getOrCreateDraftInvoice(db, hospitalId, appointmentId);
    for (const charge of charges) {
      await this.insertItem(db, invoiceId, charge);
    }
    await this.recomputeTotals(db, invoiceId);
    return invoiceId;
  }

  /** Inserts one line with a server-computed `lineTotal`. Callers own the
   * invoice lock and must call `recomputeTotals` afterwards. */
  async insertItem(db: BillingDb, invoiceId: string, charge: ChargeInput) {
    const unitPrice = new Prisma.Decimal(charge.unitPrice);
    return db.invoiceItem.create({
      data: {
        invoiceId,
        sourceType: charge.sourceType,
        sourceId: charge.sourceId,
        description: charge.description.slice(0, 500),
        quantity: charge.quantity,
        unitPrice,
        lineTotal: unitPrice.mul(charge.quantity),
      },
    });
  }

  /** FR-BILL-003: `subtotal` is the exact sum of the line items and `total`
   * is derived from it. Never accepted from client input. */
  async recomputeTotals(db: BillingDb, invoiceId: string): Promise<void> {
    const [agg, invoice] = await Promise.all([
      db.invoiceItem.aggregate({ where: { invoiceId }, _sum: { lineTotal: true } }),
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { tax: true, discount: true } }),
    ]);
    const subtotal = agg._sum.lineTotal ?? new Prisma.Decimal(0);
    await db.invoice.update({
      where: { id: invoiceId },
      data: { subtotal, total: subtotal.add(invoice.tax).sub(invoice.discount) },
    });
  }
}
