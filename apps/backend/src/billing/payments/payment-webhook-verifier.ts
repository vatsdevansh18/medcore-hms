import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import Razorpay from "razorpay";
import { PaymentProvider } from "@medcore/types";

export type WebhookOutcome = "SUCCEEDED" | "FAILED" | "IGNORED";

/** A provider event normalised to what the payment state machine needs. */
export interface VerifiedWebhookEvent {
  provider: PaymentProvider;
  eventId: string;
  eventType: string;
  outcome: WebhookOutcome;
  /** Stripe Checkout Session id / Razorpay order id: what `Payment.providerEventId` stores. */
  reference: string | null;
  /** Our `Payment.id`, when the provider echoes it back (Stripe metadata, Razorpay notes). */
  paymentId: string | null;
  amountMinor: number | null;
  currency: string | null;
}

export class WebhookSignatureError extends Error {}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * SEC-PAY-002: webhook signatures are verified with each provider's own SDK
 * function (`stripe.webhooks.constructEvent`, `Razorpay.validateWebhookSignature`)
 * against the raw request bytes, captured before JSON parsing
 * (configure-app.ts), with the secret from env. It fails closed: a missing
 * secret, missing header, or any verification error is a
 * `WebhookSignatureError`, and nothing is parsed or written.
 *
 * Deliberately separate from `CheckoutClient` (the outbound network calls)
 * so tests can replace the network hop without ever touching verification.
 */
@Injectable()
export class PaymentWebhookVerifier {
  private readonly logger = new Logger(PaymentWebhookVerifier.name);
  // Signature verification needs no API key; a placeholder avoids making
  // webhook handling depend on the checkout credentials being set.
  private readonly stripe: Stripe;

  constructor(private readonly config: ConfigService) {
    this.stripe = new Stripe(this.config.get<string>("STRIPE_SECRET_KEY") || "sk_test_unconfigured");
  }

  verify(provider: PaymentProvider, rawBody: Buffer | undefined, headers: Record<string, unknown>): VerifiedWebhookEvent {
    if (!rawBody || rawBody.length === 0) throw new WebhookSignatureError("Missing request body.");
    return provider === PaymentProvider.STRIPE ? this.verifyStripe(rawBody, headers) : this.verifyRazorpay(rawBody, headers);
  }

  private verifyStripe(rawBody: Buffer, headers: Record<string, unknown>): VerifiedWebhookEvent {
    const secret = this.config.get<string>("STRIPE_WEBHOOK_SECRET");
    const signature = asString(headers["stripe-signature"]);
    if (!secret) {
      this.logger.error("STRIPE_WEBHOOK_SECRET is not configured; rejecting Stripe webhook.");
      throw new WebhookSignatureError("Stripe webhooks are not configured.");
    }
    if (!signature) throw new WebhookSignatureError("Missing Stripe-Signature header.");

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      throw new WebhookSignatureError(err instanceof Error ? err.message : "Invalid Stripe signature.");
    }

    const session = asRecord(event.data.object);
    const metadata = asRecord(session.metadata);
    let outcome: WebhookOutcome = "IGNORED";
    switch (event.type) {
      case "checkout.session.completed":
        // Card payments complete here; delayed methods report "unpaid" and
        // settle later via the async_payment_* events.
        outcome = session.payment_status === "paid" ? "SUCCEEDED" : "IGNORED";
        break;
      case "checkout.session.async_payment_succeeded":
        outcome = "SUCCEEDED";
        break;
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired":
        outcome = "FAILED";
        break;
    }
    return {
      provider: PaymentProvider.STRIPE,
      eventId: event.id,
      eventType: event.type,
      outcome,
      reference: asString(session.id),
      paymentId: asString(metadata.paymentId),
      amountMinor: asNumber(session.amount_total),
      currency: asString(session.currency)?.toUpperCase() ?? null,
    };
  }

  private verifyRazorpay(rawBody: Buffer, headers: Record<string, unknown>): VerifiedWebhookEvent {
    const secret = this.config.get<string>("RAZORPAY_WEBHOOK_SECRET");
    const signature = asString(headers["x-razorpay-signature"]);
    if (!secret) {
      this.logger.error("RAZORPAY_WEBHOOK_SECRET is not configured; rejecting Razorpay webhook.");
      throw new WebhookSignatureError("Razorpay webhooks are not configured.");
    }
    if (!signature) throw new WebhookSignatureError("Missing X-Razorpay-Signature header.");

    const body = rawBody.toString("utf8");
    let valid = false;
    try {
      valid = Razorpay.validateWebhookSignature(body, signature, secret);
    } catch {
      valid = false;
    }
    if (!valid) throw new WebhookSignatureError("Invalid Razorpay signature.");

    let parsed: Record<string, unknown>;
    try {
      parsed = asRecord(JSON.parse(body));
    } catch {
      throw new WebhookSignatureError("Signed body is not valid JSON.");
    }
    const eventType = asString(parsed.event) ?? "unknown";
    const payload = asRecord(parsed.payload);
    const payment = asRecord(asRecord(payload.payment).entity);
    const order = asRecord(asRecord(payload.order).entity);
    const notes = asRecord(Object.keys(asRecord(order.notes)).length ? order.notes : payment.notes);

    let outcome: WebhookOutcome = "IGNORED";
    if (eventType === "payment.captured" || eventType === "order.paid") outcome = "SUCCEEDED";
    else if (eventType === "payment.failed") outcome = "FAILED";

    return {
      provider: PaymentProvider.RAZORPAY,
      // Razorpay's per-delivery id; retries of the same event reuse it.
      eventId: asString(headers["x-razorpay-event-id"]) ?? `${eventType}:${asString(payment.id) ?? asString(order.id) ?? "?"}`,
      eventType,
      outcome,
      reference: asString(order.id) ?? asString(payment.order_id),
      paymentId: asString(notes.paymentId),
      amountMinor: asNumber(payment.amount) ?? asNumber(order.amount_paid),
      currency: asString(payment.currency) ?? asString(order.currency),
    };
  }
}
