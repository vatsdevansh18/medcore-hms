import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";
import {
  isPermanentStatus,
  PermanentDeliveryError,
  type EmailSender,
  type OutboundEmail,
  type SendResult,
} from "./messaging.types";

/**
 * Resend email transport (brief §7.8). Unconfigured (`RESEND_API_KEY`
 * empty) means `isConfigured() === false`; callers then record the
 * delivery as SKIPPED rather than pretending it was sent.
 *
 * Outside production every message is redirected to `EMAIL_SANDBOX_RECIPIENT`
 * (default Resend's own test inbox, `delivered@resend.dev`), so a developer
 * key can never mail a real person (brief §13/§15 sandbox rule; D-033).
 */
@Injectable()
export class ResendEmailSender implements EmailSender {
  readonly provider = "resend";
  private readonly logger = new Logger(ResendEmailSender.name);
  private readonly client: Resend | null;
  private readonly from: string;
  private readonly sandboxRecipient: string | null;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>("RESEND_API_KEY", "");
    this.client = apiKey ? new Resend(apiKey) : null;
    this.from = config.get<string>("EMAIL_FROM", "MedCore HMS <onboarding@resend.dev>");
    this.sandboxRecipient =
      config.get<string>("NODE_ENV") === "production"
        ? null
        : config.get<string>("EMAIL_SANDBOX_RECIPIENT", "delivered@resend.dev");
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async send(message: OutboundEmail): Promise<SendResult> {
    if (!this.client) throw new PermanentDeliveryError("Resend is not configured.");
    const to = this.sandboxRecipient ?? message.to;
    const { data, error } = await this.client.emails.send(
      { from: this.from, to, subject: message.subject, text: message.text },
      message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : undefined,
    );
    if (error) {
      const detail = `Resend ${error.name} (${error.statusCode ?? "no status"}): ${error.message}`;
      if (isPermanentStatus(error.statusCode)) throw new PermanentDeliveryError(detail);
      throw new Error(detail);
    }
    if (this.sandboxRecipient) this.logger.debug(`Email sandboxed to ${to}.`);
    return { provider: this.provider, providerMessageId: data?.id ?? null, deliveredTo: to };
  }
}
