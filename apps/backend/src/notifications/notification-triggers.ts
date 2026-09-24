import { NotificationChannel, NotificationType } from "@medcore/types";

export interface NotificationTrigger {
  channels: NotificationChannel[];
  /** Email/SMS text for clinically sensitive events carries no clinical
   * detail, only a prompt to sign in (SEC-NOTIF-003). In-app keeps the full
   * body, since it's behind authentication. */
  externalContent: "full" | "minimal";
}

const { EMAIL, SMS, IN_APP } = NotificationChannel;

/**
 * The trigger table: brief §7.8, the single place that decides which
 * channels an event fans out to (FR-NOTIF-002). Producers never pick
 * channels themselves. The two rows not in the brief's table are marked;
 * see docs/11-DECISIONS.md D-032.
 */
export const NOTIFICATION_TRIGGERS: Record<NotificationType, NotificationTrigger> = {
  [NotificationType.APPOINTMENT_CONFIRMED]: { channels: [EMAIL, SMS, IN_APP], externalContent: "full" },
  // Brief: "Appointment reminder (24h) — Email + SMS"; §7.2 adds the 1h one, same channels.
  [NotificationType.APPOINTMENT_REMINDER]: { channels: [EMAIL, SMS], externalContent: "full" },
  [NotificationType.LAB_RESULT_APPROVED]: { channels: [EMAIL, IN_APP], externalContent: "minimal" },
  [NotificationType.PRESCRIPTION_READY]: { channels: [SMS, IN_APP], externalContent: "minimal" },
  [NotificationType.INVOICE_GENERATED]: { channels: [EMAIL, IN_APP], externalContent: "full" },
  [NotificationType.PAYMENT_RECEIVED]: { channels: [EMAIL, SMS], externalContent: "full" },
  [NotificationType.LOW_STOCK_ALERT]: { channels: [EMAIL, IN_APP], externalContent: "full" },
  // Brief: "In-app + SMS (doctor)". The producer's body carries no patient
  // detail, so it's safe to send in full.
  [NotificationType.EMERGENCY_APPOINTMENT]: { channels: [IN_APP, SMS], externalContent: "full" },
  // Not in the brief's table. Brief §7.6 hint: "sends a report to the
  // Pharmacist and Hospital Admin"; email + in-app like the low-stock alert (D-025).
  [NotificationType.MEDICINE_EXPIRY_DIGEST]: { channels: [EMAIL, IN_APP], externalContent: "full" },
};

export const MINIMAL_EXTERNAL_BODY =
  "You have a new update in MedCore HMS. Sign in to view the details.";
