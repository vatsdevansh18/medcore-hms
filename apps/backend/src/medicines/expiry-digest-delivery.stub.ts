import { Injectable, Logger } from "@nestjs/common";

export interface ExpiryDigestEntry {
  medicineName: string;
  batchNumber: string;
  expiryDate: string;
  quantityOnHand: number;
}

export interface ExpiryDigestParams {
  hospitalName: string;
  recipientEmails: string[];
  digestDate: string;
  entries: ExpiryDigestEntry[];
  quarantinedCount: number;
}

/**
 * FR-PHARM-005's final "email" hop. TEMPORARY STUB, the same pattern as
 * `ReminderDeliveryStub` (Phase 5) and `OtpDeliveryStub` (Phase 3): the
 * scan, digest content, recipient resolution, per-day idempotency, and the
 * persisted `Notification` rows are all real; only the SMTP send is logged
 * instead of performed, until Phase 11 wires the real email worker
 * (docs/03-ARCHITECTURE.md §7/§12, docs/11-DECISIONS.md D-025).
 */
export interface ExpiryDigestDeliveryPort {
  sendExpiryDigest(params: ExpiryDigestParams): Promise<void>;
}

@Injectable()
export class ExpiryDigestDeliveryStub implements ExpiryDigestDeliveryPort {
  private readonly logger = new Logger("ExpiryDigestDelivery[STUB]");

  async sendExpiryDigest(params: ExpiryDigestParams): Promise<void> {
    this.logger.warn(
      `[DEV STUB — Phase 11 wires real email dispatch] ${params.digestDate} expiry digest for ` +
        `${params.hospitalName} to ${params.recipientEmails.length} recipient(s): ` +
        `${params.entries.length} batch(es) expiring within 30 days, ${params.quarantinedCount} quarantined today.`,
    );
    await Promise.resolve();
  }
}

export const EXPIRY_DIGEST_DELIVERY_PORT = Symbol("EXPIRY_DIGEST_DELIVERY_PORT");
