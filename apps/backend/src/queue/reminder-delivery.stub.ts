import { Injectable, Logger } from "@nestjs/common";

/**
 * TEMPORARY STUB — same pattern as `OtpDeliveryStub` (`docs/phase-reviews/
 * PHASE-3-REVIEW.md`). Phase 11 (Notifications & Background Jobs) wires this
 * through the real `NotificationDispatcher`/multi-channel architecture
 * described in `docs/03-ARCHITECTURE.md` §7; until then it logs the reminder
 * instead of sending it, so the real part of FR-APPT-007 — scheduling,
 * idempotency, and cancellation of the BullMQ jobs — is fully real and
 * testable end-to-end, with only the final delivery hop stubbed.
 */
export interface ReminderDeliveryPort {
  sendAppointmentReminder(params: {
    appointmentId: string;
    patientEmail: string;
    scheduledStart: Date;
    window: "24h" | "1h";
  }): Promise<void>;
}

@Injectable()
export class ReminderDeliveryStub implements ReminderDeliveryPort {
  private readonly logger = new Logger("ReminderDelivery[STUB]");

  async sendAppointmentReminder(params: {
    appointmentId: string;
    patientEmail: string;
    scheduledStart: Date;
    window: "24h" | "1h";
  }): Promise<void> {
    this.logger.warn(
      `[DEV STUB — Phase 11 wires real notification dispatch] ${params.window} reminder for appointment ${params.appointmentId} (${params.patientEmail}), scheduled ${params.scheduledStart.toISOString()}`,
    );
    await Promise.resolve();
  }
}

export const REMINDER_DELIVERY_PORT = Symbol("REMINDER_DELIVERY_PORT");
