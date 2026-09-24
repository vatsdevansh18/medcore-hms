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

/** docs/03-ARCHITECTURE.md §12 `pdf-generate` queue — Phase 7. */
export const PRESCRIPTION_PDF_QUEUE = "pdf-generate";

export interface PrescriptionPdfJobData {
  prescriptionId: string;
}

/** docs/03-ARCHITECTURE.md §12 `medicine-expiry-scan` queue — Phase 9. */
export const MEDICINE_EXPIRY_SCAN_QUEUE = "medicine-expiry-scan";

/** Stable scheduler id: `upsertJobScheduler` with the same id replaces
 * rather than duplicates the schedule, so every API instance registering it
 * at boot still yields exactly one nightly job. */
export const MEDICINE_EXPIRY_SCAN_SCHEDULER_ID = "medicine-expiry-scan-nightly";

/** 00:30 UTC nightly (06:00 in the default Asia/Kolkata timezone). Each
 * hospital's "today" is still computed in its own timezone, so the exact
 * run hour only affects when the digest arrives, not which batches count as
 * expired — dispensing checks expiry itself on every request regardless. */
export const MEDICINE_EXPIRY_SCAN_CRON = "30 0 * * *";
