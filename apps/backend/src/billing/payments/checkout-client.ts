import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import Razorpay from "razorpay";
import { PaymentProvider } from "@medcore/types";

export interface CheckoutRequest {
  paymentId: string;
  invoiceId: string;
  hospitalId: string;
  amountMinor: number;
  currency: string;
  description: string;
}

export interface CheckoutResult {
  /** Stripe Checkout Session id / Razorpay order id, stored as `Payment.providerEventId`. */
  reference: string;
  /** Stripe hosted-checkout URL; null for Razorpay (its JS Checkout opens with `keyId` + `reference`). */
  checkoutUrl: string | null;
  /** Razorpay publishable key id for the client-side Checkout widget. */
  keyId: string | null;
}

/**
 * The outbound half of the payment integration: creating the provider-side
 * checkout for a server-computed amount (docs/03-ARCHITECTURE.md §9). It's a
 * separate injectable only so e2e tests can replace the network call (no
 * test-mode keys are available in CI or this dev environment). Signature
 * verification lives in `PaymentWebhookVerifier` and is never replaced.
 */
@Injectable()
export class CheckoutClient {
  constructor(private readonly config: ConfigService) {}

  isConfigured(provider: PaymentProvider): boolean {
    if (provider === PaymentProvider.STRIPE) return Boolean(this.config.get<string>("STRIPE_SECRET_KEY"));
    return Boolean(this.config.get<string>("RAZORPAY_KEY_ID") && this.config.get<string>("RAZORPAY_KEY_SECRET"));
  }

  async createCheckout(provider: PaymentProvider, req: CheckoutRequest): Promise<CheckoutResult> {
    // Our ids travel with the provider object so the webhook can be matched
    // back to exactly one PENDING Payment.
    const metadata = { paymentId: req.paymentId, invoiceId: req.invoiceId, hospitalId: req.hospitalId };

    if (provider === PaymentProvider.STRIPE) {
      const stripe = new Stripe(this.config.getOrThrow<string>("STRIPE_SECRET_KEY"));
      const frontend = this.config.get<string>("CORS_ORIGIN", "http://localhost:3000");
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        client_reference_id: req.invoiceId,
        metadata,
        payment_intent_data: { metadata },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: req.currency.toLowerCase(),
              unit_amount: req.amountMinor,
              product_data: { name: req.description },
            },
          },
        ],
        // The redirect is display-only; state changes only via the signed webhook (FR-BILL-004).
        success_url: `${frontend}/portal/invoices/${req.invoiceId}?checkout=processing`,
        cancel_url: `${frontend}/portal/invoices/${req.invoiceId}?checkout=cancelled`,
      });
      return { reference: session.id, checkoutUrl: session.url ?? null, keyId: null };
    }

    const keyId = this.config.getOrThrow<string>("RAZORPAY_KEY_ID");
    const razorpay = new Razorpay({ key_id: keyId, key_secret: this.config.getOrThrow<string>("RAZORPAY_KEY_SECRET") });
    const order = await razorpay.orders.create({
      amount: req.amountMinor,
      currency: req.currency,
      // Razorpay caps `receipt` at 40 chars; a UUID is 36.
      receipt: req.paymentId,
      notes: metadata,
    });
    return { reference: order.id, checkoutUrl: null, keyId };
  }
}
