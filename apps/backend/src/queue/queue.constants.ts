/** Split from queue.module.ts for the same reason as redis.constants.ts —
 * avoids a circular import between the module and anything outside it that
 * injects the queue token (docs/phase-reviews/PHASE-3-REVIEW.md). */
export const APPOINTMENT_REMINDER_QUEUE = "appointment-reminder";

export type ReminderWindow = "24h" | "1h";

export interface AppointmentReminderJobData {
  appointmentId: string;
  window: ReminderWindow;
}

/** BullMQ dedupes on jobId — this is what makes `FR-APPT-007`'s "idempotent
 * against duplicate sends" requirement hold even if scheduling is called
 * twice for the same appointment/window (e.g. a retried request). A `-`
 * separator, not `:` — BullMQ uses `:` internally as its own Redis
 * key-namespace separator and rejects a custom job ID containing one
 * ("Custom Id cannot contain :"), found live while testing the
 * PENDING→CONFIRMED transition. */
export function reminderJobId(appointmentId: string, window: ReminderWindow): string {
  return `${appointmentId}-${window}`;
}
