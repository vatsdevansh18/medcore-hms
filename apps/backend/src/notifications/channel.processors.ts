import type { BeforeApplicationShutdown } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job, Worker } from "bullmq";
import { ChannelDeliveryService } from "./channel-delivery.service";
import { EMAIL_QUEUE, IN_APP_QUEUE, SMS_QUEUE, type ChannelJobData } from "./notification.constants";

/**
 * One worker per channel queue (FR-NOTIF-002, brief §7.8 hint). Each has
 * its own concurrency and retry state, so an SMS outage never holds up the
 * email or in-app queues.
 *
 * Workers are closed (waiting for in-flight jobs) in
 * `beforeApplicationShutdown`. Nest tears down the Socket.IO server and its
 * Redis adapter in `dispose()`, which runs *before* `onApplicationShutdown`,
 * where @nestjs/bullmq would otherwise close them; a job still running then
 * pushed to a closed Redis connection (found in Phase 11 e2e teardown).
 */
abstract class ChannelProcessor extends WorkerHost implements BeforeApplicationShutdown {
  constructor(private readonly delivery: ChannelDeliveryService) {
    super();
  }

  process(job: Job<ChannelJobData>): Promise<void> {
    return this.delivery.deliver(job);
  }

  async beforeApplicationShutdown(): Promise<void> {
    let worker: Worker;
    try {
      worker = this.worker;
    } catch {
      return; // never initialised (the getter throws), nothing to close
    }
    await worker.close();
  }
}

@Processor(EMAIL_QUEUE, { concurrency: 5 })
export class EmailProcessor extends ChannelProcessor {
  constructor(delivery: ChannelDeliveryService) {
    super(delivery);
  }
}

@Processor(SMS_QUEUE, { concurrency: 5 })
export class SmsProcessor extends ChannelProcessor {
  constructor(delivery: ChannelDeliveryService) {
    super(delivery);
  }
}

@Processor(IN_APP_QUEUE, { concurrency: 10 })
export class InAppProcessor extends ChannelProcessor {
  constructor(delivery: ChannelDeliveryService) {
    super(delivery);
  }
}
