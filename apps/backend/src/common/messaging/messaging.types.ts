/**
 * Provider ports for outbound email and SMS (docs/03-ARCHITECTURE.md §7).
 * Everything that sends a message depends on these interfaces, never on the
 * Resend/Twilio SDKs directly, so e2e specs can swap in a controllable fake
 * with `overrideProvider` (the same approach as Phase 10's `CheckoutClient`).
 */
export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  /** Provider-side idempotency key: a retried job must not send twice. */
  idempotencyKey?: string;
}

export interface OutboundSms {
  to: string;
  body: string;
}

export interface SendResult {
  provider: string;
  providerMessageId: string | null;
  /** The address actually used, after any non-production sandbox redirect. */
  deliveredTo: string;
}

/** A provider rejection that retrying can't fix (bad address, invalid
 * credentials, validation error). Workers stop retrying on it. */
export class PermanentDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentDeliveryError";
  }
}

export interface EmailSender {
  readonly provider: string;
  isConfigured(): boolean;
  send(message: OutboundEmail): Promise<SendResult>;
}

export interface SmsSender {
  readonly provider: string;
  isConfigured(): boolean;
  send(message: OutboundSms): Promise<SendResult>;
}

export const EMAIL_SENDER = Symbol("EMAIL_SENDER");
export const SMS_SENDER = Symbol("SMS_SENDER");

/** 4xx other than 408/429 is the provider saying "this request is wrong",
 * which a retry won't change. Everything else (5xx, timeouts, rate limits,
 * network errors with no status) is worth retrying. */
export function isPermanentStatus(status: number | null | undefined): boolean {
  return typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 429;
}
