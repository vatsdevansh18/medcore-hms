import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import twilio from "twilio";
import {
  isPermanentStatus,
  PermanentDeliveryError,
  type OutboundSms,
  type SendResult,
  type SmsSender,
} from "./messaging.types";

type TwilioClient = ReturnType<typeof twilio>;

/**
 * Twilio SMS transport (brief §7.8, FR-AUTH-005). Needs all three of
 * `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`; otherwise
 * unconfigured. Outside production, `SMS_SANDBOX_RECIPIENT` (if set)
 * replaces every destination number (D-033). Twilio *test credentials*
 * accept any destination and never deliver, which is the intended dev setup.
 */
@Injectable()
export class TwilioSmsSender implements SmsSender {
  readonly provider = "twilio";
  private readonly client: TwilioClient | null;
  private readonly from: string;
  private readonly sandboxRecipient: string | null;

  constructor(config: ConfigService) {
    const sid = config.get<string>("TWILIO_ACCOUNT_SID", "");
    const token = config.get<string>("TWILIO_AUTH_TOKEN", "");
    this.from = config.get<string>("TWILIO_FROM_NUMBER", "");
    this.client = sid && token && this.from ? twilio(sid, token) : null;
    const sandbox = config.get<string>("SMS_SANDBOX_RECIPIENT", "");
    this.sandboxRecipient = config.get<string>("NODE_ENV") === "production" || !sandbox ? null : sandbox;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async send(message: OutboundSms): Promise<SendResult> {
    if (!this.client) throw new PermanentDeliveryError("Twilio is not configured.");
    const to = this.sandboxRecipient ?? message.to;
    try {
      const sent = await this.client.messages.create({ from: this.from, to, body: message.body });
      return { provider: this.provider, providerMessageId: sent.sid, deliveredTo: to };
    } catch (err) {
      const status = (err as { status?: number }).status;
      const code = (err as { code?: number }).code;
      const detail = `Twilio ${code ?? "error"} (${status ?? "no status"}): ${err instanceof Error ? err.message : String(err)}`;
      if (isPermanentStatus(status)) throw new PermanentDeliveryError(detail);
      throw new Error(detail);
    }
  }
}
