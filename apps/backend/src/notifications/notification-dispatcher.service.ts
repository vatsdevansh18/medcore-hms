import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectQueue } from "@nestjs/bullmq";
import { OnEvent } from "@nestjs/event-emitter";
import type { JobsOptions, Queue } from "bullmq";
import type { NotificationChannel } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import {
  CHANNEL_JOB_ATTEMPTS,
  CHANNEL_QUEUES,
  channelJobId,
  EMAIL_QUEUE,
  IN_APP_QUEUE,
  NOTIFICATIONS_COMMITTED_EVENT,
  OUTBOX_BATCH_SIZE,
  SMS_QUEUE,
  type ChannelJobData,
} from "./notification.constants";

interface BulkJob {
  name: string;
  data: ChannelJobData;
  opts: JobsOptions;
}

/**
 * The fan-out step of docs/03-ARCHITECTURE.md §7. It listens on the
 * in-process event bus and turns committed outbox rows into one BullMQ job
 * per channel (FR-NOTIF-002). Each channel has its own queue and worker, so
 * a failing SMS provider only ever affects SMS jobs.
 *
 * Order is enqueue first, then mark `dispatchedAt`. A crash in between
 * leaves the row undispatched and the next drain re-enqueues it; the
 * deterministic job id (`notificationId-channel`) makes that re-add a no-op
 * in BullMQ, so nothing is sent twice. The drain reads across hospitals
 * (a system process with no caller) via `TenantContext.bypass()`.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);
  private readonly queues: Record<string, Queue<ChannelJobData>>;
  private readonly retryBaseDelayMs: number;
  private running: Promise<number> | null = null;
  private rerun = false;

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    @InjectQueue(EMAIL_QUEUE) email: Queue<ChannelJobData>,
    @InjectQueue(SMS_QUEUE) sms: Queue<ChannelJobData>,
    @InjectQueue(IN_APP_QUEUE) inApp: Queue<ChannelJobData>,
    config: ConfigService,
  ) {
    this.queues = { [EMAIL_QUEUE]: email, [SMS_QUEUE]: sms, [IN_APP_QUEUE]: inApp };
    this.retryBaseDelayMs = Number(config.get("NOTIFICATION_RETRY_BASE_DELAY_MS", 5000));
  }

  /** Event-bus listener. It must never throw into the emitter: the domain
   * change has already committed (NFR-AVAIL-003), and the sweep retries. */
  @OnEvent(NOTIFICATIONS_COMMITTED_EVENT)
  onCommitted(): void {
    this.drain().catch((err: unknown) =>
      this.logger.error(
        `Outbox drain failed (the sweep will retry): ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  /** Coalesces concurrent signals: while a drain is running, another signal
   * sets a flag so it loops once more and picks up rows committed after its
   * query ran. */
  drain(): Promise<number> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      let total = 0;
      try {
        do {
          this.rerun = false;
          total += await this.drainOnce(0);
        } while (this.rerun);
      } finally {
        this.running = null;
      }
      return total;
    })();
    return this.running;
  }

  /** One pass over undispatched rows at least `minAgeMs` old. Safe to run
   * alongside other passes or other API instances (idempotent job ids). */
  async drainOnce(minAgeMs: number): Promise<number> {
    let dispatched = 0;
    for (;;) {
      // No age filter at all for the event-driven drain. `createdAt` comes
      // from the database clock, and comparing it with this process's clock
      // silently skipped just-committed rows whenever the DB clock ran a few
      // ms ahead (found as an intermittent Phase 11 e2e failure: row
      // committed, signal received, drain saw nothing). Only the sweep's
      // coarse 10s guard uses the local clock, where small skew is harmless.
      const ageFilter = minAgeMs > 0 ? { createdAt: { lte: new Date(Date.now() - minAgeMs) } } : {};
      const rows = await TenantContext.bypass(() =>
        this.prisma.notification.findMany({
          where: { dispatchedAt: null, ...ageFilter },
          select: { id: true, channels: true },
          orderBy: { createdAt: "asc" },
          take: OUTBOX_BATCH_SIZE,
        }),
      );
      if (rows.length === 0) break;

      const byQueue = new Map<string, BulkJob[]>();
      for (const row of rows) {
        for (const channel of row.channels as NotificationChannel[]) {
          const queueName = CHANNEL_QUEUES[channel];
          const jobs = byQueue.get(queueName) ?? [];
          jobs.push({
            name: channel,
            data: { notificationId: row.id, channel },
            opts: {
              jobId: channelJobId(row.id, channel),
              attempts: CHANNEL_JOB_ATTEMPTS,
              backoff: { type: "exponential", delay: this.retryBaseDelayMs },
              removeOnComplete: { age: 7 * 24 * 60 * 60 },
              // The failed set is the dead-letter store (NFR-AVAIL-002):
              // kept 30 days for inspection in Bull Board, never dropped.
              removeOnFail: { age: 30 * 24 * 60 * 60 },
            },
          });
          byQueue.set(queueName, jobs);
        }
      }
      for (const [queueName, jobs] of byQueue) {
        await this.queues[queueName].addBulk(jobs);
      }

      const ids = rows.map((r) => r.id);
      await TenantContext.bypass(() =>
        this.prisma.notification.updateMany({
          where: { id: { in: ids }, dispatchedAt: null },
          data: { dispatchedAt: new Date() },
        }),
      );
      dispatched += rows.length;
      if (rows.length < OUTBOX_BATCH_SIZE) break;
    }
    if (dispatched > 0) this.logger.debug(`Dispatched ${dispatched} notification(s).`);
    return dispatched;
  }

  /** A channel job's BullMQ state ("completed", "failed", "delayed", ...).
   * For e2e specs and operational checks; the same pattern as
   * `AppointmentReminderQueueService.hasReminderJob`. */
  async channelJobState(
    notificationId: string,
    channel: NotificationChannel,
  ): Promise<{ state: string; attemptsMade: number } | null> {
    const job = await this.queues[CHANNEL_QUEUES[channel]].getJob(channelJobId(notificationId, channel));
    if (!job) return null;
    return { state: await job.getState(), attemptsMade: job.attemptsMade };
  }
}
