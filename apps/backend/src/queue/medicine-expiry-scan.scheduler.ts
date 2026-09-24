import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import {
  MEDICINE_EXPIRY_SCAN_CRON,
  MEDICINE_EXPIRY_SCAN_QUEUE,
  MEDICINE_EXPIRY_SCAN_SCHEDULER_ID,
} from "./queue.constants";

/** Registers the nightly `medicine-expiry-scan` cron at boot. Idempotent
 * (see MEDICINE_EXPIRY_SCAN_SCHEDULER_ID). */
@Injectable()
export class MedicineExpiryScanScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MedicineExpiryScanScheduler.name);

  constructor(@InjectQueue(MEDICINE_EXPIRY_SCAN_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      MEDICINE_EXPIRY_SCAN_SCHEDULER_ID,
      { pattern: MEDICINE_EXPIRY_SCAN_CRON, tz: "UTC" },
      { name: "nightly-scan", data: {} },
    );
    this.logger.log(
      `Scheduled ${MEDICINE_EXPIRY_SCAN_QUEUE} at "${MEDICINE_EXPIRY_SCAN_CRON}" UTC.`,
    );
  }

  /** Lets e2e tests assert the schedule is registered without importing
   * `@nestjs/bullmq`'s queue token (same reason as
   * AppointmentReminderQueueService.hasReminderJob). */
  async getSchedule(): Promise<{ id: string; pattern: string | null } | null> {
    const scheduler = await this.queue.getJobScheduler(MEDICINE_EXPIRY_SCAN_SCHEDULER_ID);
    if (!scheduler) return null;
    return { id: MEDICINE_EXPIRY_SCAN_SCHEDULER_ID, pattern: scheduler.pattern ?? null };
  }
}
