import { NotificationChannel } from "@medcore/types";

/** Split from notifications.module.ts so processors/services importing a
 * queue name never import the module file (same reason as queue.constants.ts). */
export const EMAIL_QUEUE = "email";
export const SMS_QUEUE = "sms";
export const IN_APP_QUEUE = "in-app";
export const NOTIFICATION_OUTBOX_QUEUE = "notification-outbox";

export const CHANNEL_QUEUES: Record<NotificationChannel, string> = {
  [NotificationChannel.EMAIL]: EMAIL_QUEUE,
  [NotificationChannel.SMS]: SMS_QUEUE,
  [NotificationChannel.IN_APP]: IN_APP_QUEUE,
};

export interface ChannelJobData {
  notificationId: string;
  channel: NotificationChannel;
}

/** docs/03-ARCHITECTURE.md §12 idempotency key "notificationId + channel".
 * BullMQ ignores an add whose jobId already exists, so the dispatcher and
 * the sweeper (or two API instances) can both enqueue the same row safely.
 * `-`, not `:` (BullMQ rejects `:` in custom ids; Phase 5). */
export function channelJobId(notificationId: string, channel: NotificationChannel): string {
  return `${notificationId}-${channel}`;
}

/** In-process event bus signal: "outbox rows were committed, drain now". */
export const NOTIFICATIONS_COMMITTED_EVENT = "notifications.committed";

export const OUTBOX_SWEEP_SCHEDULER_ID = "notification-outbox-sweep";
/** Crash-recovery sweep: catches rows whose post-commit signal was lost. */
export const OUTBOX_SWEEP_INTERVAL_MS = 30_000;
/** Rows younger than this are left to the post-commit signal, so the sweep
 * doesn't race a drain that's already handling them (harmless, just noisy). */
export const OUTBOX_SWEEP_MIN_AGE_MS = 10_000;
export const OUTBOX_BATCH_SIZE = 200;

/** NFR-AVAIL-002: 3 attempts, exponential backoff, then dead-lettered
 * (kept in the queue's failed set for inspection via Bull Board). */
export const CHANNEL_JOB_ATTEMPTS = 3;
