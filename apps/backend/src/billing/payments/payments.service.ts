import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ApiErrorCode,
  InvoiceStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
} from "@medcore/types";
import { PRISMA_CLIENT } from "../../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../../prisma/prisma-client.factory";
import { TenantContext } from "../../common/tenancy/tenant-context";
import { AppException } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../auth/interfaces/authenticated-user.interface";
import { ChargesService, type BillingDb } from "../charges.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { InvoiceLedgerService } from "../invoice-ledger.service";
import { InvoicesService } from "../invoices.service";
import type { CashPaymentDto } from "../dto/cash-payment.dto";
import type { CheckoutSessionDto } from "../dto/checkout-session.dto";
import { CheckoutClient } from "./checkout-client";
import {
  PaymentWebhookVerifier,
  WebhookSignatureError,
  type VerifiedWebhookEvent,
} from "./payment-webhook-verifier";

const PAYABLE: string[] = [InvoiceStatus.FINALIZED, InvoiceStatus.PARTIALLY_PAID];

function toMinor(amount: Prisma.Decimal): number {
  return amount.mul(100).toDecimalPlaces(0).toNumber();
}

/**
 * FR-BILL-004/005/006. Payment state changes only through (a) a
 * signature-verified provider webhook or (b) an explicit staff cash action.
 * Nothing a patient's browser reports ever changes payment or invoice state
 * (SEC-PAY-001).
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly charges: ChargesService,
    private readonly ledger: InvoiceLedgerService,
    private readonly invoices: InvoicesService,
    private readonly checkout: CheckoutClient,
    private readonly verifier: PaymentWebhookVerifier,
    private readonly notifications: NotificationsService,
  ) {}

  private assertPayable(status: string): void {
    if (status === InvoiceStatus.DRAFT) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "The invoice must be finalized before it can be paid.",
        HttpStatus.CONFLICT,
      );
    }
    if (!PAYABLE.includes(status)) {
      throw new AppException(ApiErrorCode.VALIDATION_ERROR, `The invoice is ${status}; nothing to pay.`, HttpStatus.CONFLICT);
    }
  }

  /** `POST /invoices/:id/cash-payment`: Receptionist/Accountant (§3.8). */
  async recordCash(invoiceId: string, dto: CashPaymentDto, caller: AuthenticatedUser) {
    if (!caller.hospitalId) throw new NotFoundException("Invoice not found.");
    const hospitalId = caller.hospitalId;
    const amount = new Prisma.Decimal(dto.amount);

    const result = await TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, () =>
      this.prisma.$transaction(async (tx) => {
        // The lock serialises concurrent cash payments, so two cashiers
        // can't both take the same remaining balance.
        if (!(await this.charges.lockInvoice(tx, hospitalId, invoiceId))) {
          throw new NotFoundException("Invoice not found.");
        }
        const before = await this.ledger.balance(tx, invoiceId);
        this.assertPayable(before.status);
        if (amount.gt(before.balanceDue)) {
          throw new AppException(
            ApiErrorCode.VALIDATION_ERROR,
            `Amount exceeds the balance due (${before.balanceDue.toFixed(2)}).`,
            HttpStatus.UNPROCESSABLE_ENTITY,
            { balanceDue: before.balanceDue.toFixed(2) },
          );
        }

        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { id: invoiceId },
          include: { patient: { select: { userId: true } } },
        });
        const payment = await tx.payment.create({
          data: {
            hospitalId,
            invoiceId,
            method: PaymentMethod.CASH,
            amount,
            currency: invoice.currency,
            status: PaymentStatus.SUCCEEDED,
            recordedBy: caller.sub,
          },
        });
        const balance = await this.ledger.applyPaymentStatus(tx, invoiceId);
        await this.ledger.notifyPaymentReceived(tx, {
          hospitalId,
          invoiceId,
          patientUserId: invoice.patient.userId,
          paymentId: payment.id,
          amount,
          currency: invoice.currency,
          method: PaymentMethod.CASH,
          balance,
        });
        return {
          receipt: {
            paymentId: payment.id,
            method: payment.method,
            amount: payment.amount,
            currency: payment.currency,
            recordedAt: payment.createdAt,
          },
          invoice: await this.invoices.view(tx, invoiceId),
        };
      }),
    );
    this.notifications.publish();
    return result;
  }

  /**
   * `POST /invoices/:id/checkout-session`: the patient pays their own
   * invoice online. The amount is always the server-computed balance due.
   * A PENDING `Payment` is created *before* the provider call and its id
   * travels in the provider metadata, so a webhook can always be matched to
   * exactly one row, even if storing the provider reference afterwards failed.
   */
  async createCheckoutSession(invoiceId: string, dto: CheckoutSessionDto, caller: AuthenticatedUser) {
    if (!caller.hospitalId) throw new NotFoundException("Invoice not found.");
    const hospitalId = caller.hospitalId;
    const scope = { hospitalId, userId: caller.sub, bypassTenancy: false };

    if (!this.checkout.isConfigured(dto.provider)) {
      throw new AppException(
        ApiErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
        `${dto.provider} checkout is not configured on this server.`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const pending = await TenantContext.run(scope, () =>
      this.prisma.$transaction(async (tx) => {
        if (!(await this.charges.lockInvoice(tx, hospitalId, invoiceId))) {
          throw new NotFoundException("Invoice not found.");
        }
        const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
        const own = await tx.patientProfile.findUnique({ where: { userId: caller.sub } });
        if (!own || own.id !== invoice.patientId) throw new NotFoundException("Invoice not found.");

        const balance = await this.ledger.balance(tx, invoiceId);
        this.assertPayable(balance.status);
        if (!balance.balanceDue.gt(0)) {
          throw new AppException(ApiErrorCode.VALIDATION_ERROR, "Nothing is due on this invoice.", HttpStatus.CONFLICT);
        }
        return tx.payment.create({
          data: {
            hospitalId,
            invoiceId,
            method: dto.provider === PaymentProvider.STRIPE ? PaymentMethod.STRIPE : PaymentMethod.RAZORPAY,
            amount: balance.balanceDue,
            currency: invoice.currency,
            status: PaymentStatus.PENDING,
          },
        });
      }),
    );

    let result;
    try {
      result = await this.checkout.createCheckout(dto.provider, {
        paymentId: pending.id,
        invoiceId,
        hospitalId,
        amountMinor: toMinor(pending.amount),
        currency: pending.currency,
        description: `MedCore invoice ${invoiceId}`,
      });
    } catch (err) {
      this.logger.error(
        `${dto.provider} checkout creation failed for payment ${pending.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await TenantContext.run(scope, () =>
        this.prisma.payment.update({ where: { id: pending.id }, data: { status: PaymentStatus.FAILED } }),
      );
      throw new AppException(
        ApiErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
        "The payment provider could not start checkout. Please try again.",
        HttpStatus.BAD_GATEWAY,
      );
    }

    await TenantContext.run(scope, () =>
      this.prisma.payment.update({ where: { id: pending.id }, data: { providerEventId: result.reference } }),
    );
    return {
      paymentId: pending.id,
      provider: dto.provider,
      reference: result.reference,
      checkoutUrl: result.checkoutUrl,
      keyId: result.keyId,
      amount: pending.amount,
      currency: pending.currency,
    };
  }

  /**
   * `POST /payments/webhook/{provider}` (no auth; the signature is the
   * authentication). Invalid signature → 400 `WEBHOOK_SIGNATURE_INVALID`,
   * nothing written. Valid → always 200, including duplicates and events we
   * don't act on (SEC-PAY-003: a redelivery is a no-op, so the provider
   * doesn't retry forever).
   *
   * Idempotency (FR-BILL-005): a payment settles through a conditional
   * `PENDING -> SUCCEEDED/FAILED` update under the invoice lock, so only
   * the first delivery of any event for that checkout can apply funds. The
   * unique `Payment.providerEventId` (the checkout reference) guarantees a
   * reference maps to at most one Payment row.
   */
  async handleWebhook(provider: PaymentProvider, rawBody: Buffer | undefined, headers: Record<string, unknown>) {
    let event: VerifiedWebhookEvent;
    try {
      event = this.verifier.verify(provider, rawBody, headers);
    } catch (err) {
      if (err instanceof WebhookSignatureError) {
        this.logger.warn(`Rejected ${provider} webhook: ${err.message}`);
        throw new AppException(
          ApiErrorCode.WEBHOOK_SIGNATURE_INVALID,
          "Webhook signature verification failed.",
          HttpStatus.BAD_REQUEST,
        );
      }
      throw err;
    }

    if (event.outcome === "IGNORED") return { received: true, applied: false };

    // No user or tenant context on a webhook: find the payment as the system,
    // then do all the work scoped to the payment's own hospital.
    const payment = await TenantContext.bypass(() =>
      this.prisma.payment.findFirst({
        where: event.paymentId ? { id: event.paymentId } : { providerEventId: event.reference ?? "__none__" },
      }),
    );
    const expectedMethod = provider === PaymentProvider.STRIPE ? PaymentMethod.STRIPE : PaymentMethod.RAZORPAY;
    if (
      !payment ||
      payment.method !== expectedMethod ||
      (payment.providerEventId && event.reference && payment.providerEventId !== event.reference)
    ) {
      // Validly signed but not ours to settle (e.g. a checkout created
      // outside this system). Acknowledge so it isn't retried, and log it for
      // reconciliation.
      this.logger.warn(
        `${provider} webhook ${event.eventId} (${event.eventType}) matched no pending payment (ref ${event.reference ?? "none"}).`,
      );
      return { received: true, applied: false };
    }

    const hospitalId = payment.hospitalId;
    const applied = await TenantContext.run({ hospitalId, userId: null, bypassTenancy: false }, () =>
      this.prisma.$transaction(async (tx) => this.applyEvent(tx, hospitalId, payment.id, payment.invoiceId, event)),
    );
    if (applied) this.notifications.publish();
    return { received: true, applied };
  }

  private async applyEvent(
    tx: BillingDb,
    hospitalId: string,
    paymentId: string,
    invoiceId: string,
    event: VerifiedWebhookEvent,
  ): Promise<boolean> {
    await this.charges.lockInvoice(tx, hospitalId, invoiceId);
    const current = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });

    const reported = event.amountMinor !== null ? new Prisma.Decimal(event.amountMinor).div(100) : current.amount;
    if (event.outcome === "SUCCEEDED" && !reported.eq(current.amount)) {
      // Record what the provider actually captured; the invoice status is
      // derived from real amounts, so this can't over- or under-credit it.
      this.logger.warn(`Payment ${paymentId}: provider captured ${reported.toFixed(2)}, expected ${current.amount.toFixed(2)}.`);
    }
    if (event.currency && event.currency.toUpperCase() !== current.currency.toUpperCase()) {
      this.logger.warn(`Payment ${paymentId}: provider currency ${event.currency} differs from ${current.currency}.`);
    }

    const claim = await tx.payment.updateMany({
      where: { id: paymentId, status: PaymentStatus.PENDING },
      data: {
        status: event.outcome === "SUCCEEDED" ? PaymentStatus.SUCCEEDED : PaymentStatus.FAILED,
        amount: event.outcome === "SUCCEEDED" && reported.gt(0) ? reported : current.amount,
        providerSignatureVerified: true,
        providerEventId: current.providerEventId ?? event.reference,
        // Identifiers and amounts only. No card, customer, or contact data
        // is ever persisted from a provider payload.
        rawPayloadSanitized: {
          eventId: event.eventId,
          eventType: event.eventType,
          reference: event.reference,
          amountMinor: event.amountMinor,
          currency: event.currency,
        },
      },
    });
    if (claim.count === 0) {
      this.logger.log(`Webhook ${event.eventId} for payment ${paymentId}: already settled (${current.status}); no-op.`);
      return false;
    }
    if (event.outcome !== "SUCCEEDED") return true;

    const balance = await this.ledger.applyPaymentStatus(tx, invoiceId);
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { patient: { select: { userId: true } } },
    });
    await this.ledger.notifyPaymentReceived(tx, {
      hospitalId,
      invoiceId,
      patientUserId: invoice.patient.userId,
      paymentId,
      amount: reported,
      currency: current.currency,
      method: current.method,
      balance,
    });
    return true;
  }
}
