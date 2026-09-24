import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  InvoiceStatus,
  NotificationChannel,
  NotificationType,
  PaymentStatus,
} from "@medcore/types";
import type { BillingDb } from "./charges.service";

/** Statuses whose balance can still change through payments or credits. */
const PAYABLE_STATUSES: string[] = [InvoiceStatus.FINALIZED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.PAID];

export interface InvoiceBalance {
  status: string;
  total: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  balanceDue: Prisma.Decimal;
}

/**
 * FR-BILL-006 / SEC-PAY-001: invoice payment status is always *derived*,
 * never set by a client. It's the sum of SUCCEEDED payments compared with
 * the server-computed total, recomputed inside the same transaction as
 * whatever changed either side (a payment, a credit line, finalization).
 */
@Injectable()
export class InvoiceLedgerService {
  private readonly logger = new Logger(InvoiceLedgerService.name);

  async amountPaid(db: BillingDb, invoiceId: string): Promise<Prisma.Decimal> {
    const agg = await db.payment.aggregate({
      where: { invoiceId, status: PaymentStatus.SUCCEEDED },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? new Prisma.Decimal(0);
  }

  async balance(db: BillingDb, invoiceId: string): Promise<InvoiceBalance> {
    const [invoice, amountPaid] = await Promise.all([
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true, total: true } }),
      this.amountPaid(db, invoiceId),
    ]);
    const due = invoice.total.sub(amountPaid);
    return {
      status: invoice.status,
      total: invoice.total,
      amountPaid,
      balanceDue: due.lt(0) ? new Prisma.Decimal(0) : due,
    };
  }

  /** Re-derives FINALIZED / PARTIALLY_PAID / PAID from payments. DRAFT,
   * CANCELLED and REFUNDED are never changed here: a payment that somehow
   * lands on one is still recorded (money was taken), just flagged in the
   * log for reconciliation. Caller must hold the invoice lock. */
  async applyPaymentStatus(db: BillingDb, invoiceId: string): Promise<InvoiceBalance> {
    const current = await this.balance(db, invoiceId);
    if (!PAYABLE_STATUSES.includes(current.status)) {
      this.logger.warn(`Invoice ${invoiceId} is ${current.status}; payment status not re-derived (reconcile manually).`);
      return current;
    }
    let next: string;
    if (current.amountPaid.gte(current.total)) next = InvoiceStatus.PAID;
    else if (current.amountPaid.gt(0)) next = InvoiceStatus.PARTIALLY_PAID;
    else next = InvoiceStatus.FINALIZED;

    if (next !== current.status) {
      await db.invoice.update({
        where: { id: invoiceId },
        data: { status: next as (typeof InvoiceStatus)[keyof typeof InvoiceStatus] },
      });
    }
    return { ...current, status: next };
  }

  /** FR-BILL-006 "triggers a receipt notification": one `Notification` row
   * for the patient's portal account, same real-row-now, dispatch-in-Phase-11
   * scoping as D-020/D-025. The payment id is the receipt reference. A
   * patient without a portal account gets none (the same Phase 4 limitation
   * as lab results). */
  async notifyPaymentReceived(
    db: BillingDb,
    params: {
      hospitalId: string;
      invoiceId: string;
      patientUserId: string | null;
      paymentId: string;
      amount: Prisma.Decimal;
      currency: string;
      method: string;
      balance: InvoiceBalance;
    },
  ): Promise<void> {
    if (!params.patientUserId) return;
    await db.notification.create({
      data: {
        hospitalId: params.hospitalId,
        recipientUserId: params.patientUserId,
        type: NotificationType.PAYMENT_RECEIVED,
        title: "Payment received",
        body:
          `Received ${params.currency} ${params.amount.toFixed(2)} by ${params.method}. ` +
          `Receipt ${params.paymentId}. Invoice status: ${params.balance.status}, ` +
          `balance due ${params.currency} ${params.balance.balanceDue.toFixed(2)}.`,
        channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        relatedEntityType: "Payment",
        relatedEntityId: params.paymentId,
      },
    });
  }
}
