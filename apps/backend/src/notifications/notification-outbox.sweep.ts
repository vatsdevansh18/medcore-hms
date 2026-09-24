import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { NotificationDispatcher } from "./notification-dispatcher.service";
import {
  NOTIFICATION_OUTBOX_QUEUE,
  OUTBOX_SWEEP_INTERVAL_MS,
  OUTBOX_SWEEP_MIN_AGE_MS,
  OUTBOX_SWEEP_SCHEDULER_ID,
} from "./notification.constants";

/** Registers the outbox sweep at boot. `upsertJobScheduler` with a stable
 * id means every API instance registering it still yields one schedule. */
@Injectable()
export class NotificationOutboxScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationOutboxScheduler.name);

  constructor(@InjectQueue(NOTIFICATION_OUTBOX_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      OUTBOX_SWEEP_SCHEDULER_ID,
      { every: OUTBOX_SWEEP_INTERVAL_MS },
      { name: "sweep", data: {}, opts: { removeOnComplete: 100, removeOnFail: 100 } },
    );
    this.logger.log(`Scheduled ${NOTIFICATION_OUTBOX_QUEUE} every ${OUTBOX_SWEEP_INTERVAL_MS / 1000}s.`);
  }
}

/**
 * Crash recovery for the transactional outbox (docs/11-DECISIONS.md D-032).
 * The post-commit event normally dispatches a row within milliseconds; this
 * catches any row whose signal was lost (a process exit between commit and
 * publish, a Redis blip during the drain, a producer path with no signal).
 */
@Processor(NOTIFICATION_OUTBOX_QUEUE)
export class NotificationOutboxSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationOutboxSweepProcessor.name);

  constructor(private readonly dispatcher: NotificationDispatcher) {
    super();
  }

  async process(): Promise<number> {
    const recovered = await this.dispatcher.drainOnce(OUTBOX_SWEEP_MIN_AGE_MS);
    if (recovered > 0) this.logger.warn(`Outbox sweep dispatched ${recovered} notification(s) missed by the event bus.`);
    return recovered;
  }
}
