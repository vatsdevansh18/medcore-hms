import { Injectable, Logger } from "@nestjs/common";

/**
 * TEMPORARY STUB. Real email (Resend) and SMS (Twilio) delivery are wired
 * up in Phase 11 (Notifications & Background Jobs) — until then, this logs
 * the OTP instead of sending it, so the system stays fully testable
 * end-to-end (a developer reads the code from server logs) without faking
 * the actual OTP generation/storage/verification logic, which is real.
 * Phase 11 replaces this class; nothing else needs to change — OtpService
 * depends on the `OtpDeliveryPort` interface, not this implementation.
 */
export interface OtpDeliveryPort {
  sendEmailOtp(email: string, code: string): Promise<void>;
  sendSmsOtp(phone: string, code: string): Promise<void>;
  sendPasswordResetEmail(email: string, token: string): Promise<void>;
}

@Injectable()
export class OtpDeliveryStub implements OtpDeliveryPort {
  private readonly logger = new Logger("OtpDelivery[STUB]");

  async sendEmailOtp(email: string, code: string): Promise<void> {
    this.logger.warn(`[DEV STUB — Phase 11 wires real email] OTP for ${email}: ${code}`);
    await Promise.resolve();
  }

  async sendSmsOtp(phone: string, code: string): Promise<void> {
    this.logger.warn(`[DEV STUB — Phase 11 wires real SMS] OTP for ${phone}: ${code}`);
    await Promise.resolve();
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    this.logger.warn(
      `[DEV STUB — Phase 11 wires real email] Password reset token for ${email}: ${token}`,
    );
    await Promise.resolve();
  }
}

export const OTP_DELIVERY_PORT = Symbol("OTP_DELIVERY_PORT");
