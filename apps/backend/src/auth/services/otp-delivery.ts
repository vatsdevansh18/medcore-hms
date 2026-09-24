import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  EMAIL_SENDER,
  SMS_SENDER,
  type EmailSender,
  type SmsSender,
} from "../../common/messaging/messaging.types";

/**
 * Delivery of auth secrets: email OTP, SMS OTP (FR-AUTH-001/005) and the
 * password-reset token. OtpService and PasswordResetService depend on this
 * interface, not the implementation (e2e specs capture codes through it).
 */
export interface OtpDeliveryPort {
  sendEmailOtp(email: string, code: string): Promise<void>;
  sendSmsOtp(phone: string, code: string): Promise<void>;
  sendPasswordResetEmail(email: string, token: string): Promise<void>;
}

export const OTP_DELIVERY_PORT = Symbol("OTP_DELIVERY_PORT");

/**
 * Phase 11 replacement for the Phase 3 `OtpDeliveryStub`. Unlike trigger
 * notifications, these are sent directly and synchronously rather than
 * through the outbox and queues (docs/11-DECISIONS.md D-033): the user is
 * waiting on the code, and a secret must never be persisted in a
 * `Notification` row (readable via `GET /notifications/me`) or in BullMQ job
 * data (kept in Redis for days).
 *
 * A send failure is logged, never thrown: `forgot-password` must respond the
 * same whether or not the email exists (SEC-AUTHN-006), and the user can
 * always ask for a new code. Outside production the code is also written to
 * the log, as in Phase 3, because non-production email goes to a sandbox
 * inbox the developer can't read. Production never logs it.
 */
@Injectable()
export class MessagingOtpDelivery implements OtpDeliveryPort {
  private readonly logger = new Logger("OtpDelivery");
  private readonly isProduction: boolean;
  private readonly appBaseUrl: string;

  constructor(
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    config: ConfigService,
  ) {
    this.isProduction = config.get<string>("NODE_ENV") === "production";
    this.appBaseUrl = config.get<string>("CORS_ORIGIN", "http://localhost:3000").split(",")[0].trim();
  }

  async sendEmailOtp(email: string, code: string): Promise<void> {
    this.devLog(`Email OTP for ${email}: ${code}`);
    await this.sendEmail(email, "Your MedCore HMS verification code", [
      `Your MedCore HMS verification code is ${code}.`,
      "It expires in 10 minutes. If you didn't request it, you can ignore this email.",
    ]);
  }

  async sendSmsOtp(phone: string, code: string): Promise<void> {
    this.devLog(`SMS OTP for ${phone}: ${code}`);
    if (!this.sms.isConfigured()) {
      this.unconfigured("SMS");
      return;
    }
    try {
      await this.sms.send({ to: phone, body: `MedCore HMS: your verification code is ${code}. It expires in 10 minutes.` });
    } catch (err) {
      this.logger.error(`SMS OTP delivery failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    this.devLog(`Password reset token for ${email}: ${token}`);
    const link = `${this.appBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.sendEmail(email, "Reset your MedCore HMS password", [
      "Someone asked to reset the password for this MedCore HMS account.",
      `To choose a new password, open this link within 60 minutes: ${link}`,
      "If it wasn't you, ignore this email; your password stays the same.",
    ]);
  }

  private async sendEmail(to: string, subject: string, lines: string[]): Promise<void> {
    if (!this.email.isConfigured()) {
      this.unconfigured("Email");
      return;
    }
    try {
      await this.email.send({ to, subject, text: lines.join("\n\n") });
    } catch (err) {
      this.logger.error(`${subject} email failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private devLog(message: string): void {
    if (!this.isProduction) this.logger.warn(`[NON-PRODUCTION ONLY] ${message}`);
  }

  private unconfigured(channel: string): void {
    const log = this.isProduction ? this.logger.error.bind(this.logger) : this.logger.debug.bind(this.logger);
    log(`${channel} provider is not configured; auth message not delivered.`);
  }
}
