import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import {
  APPOINTMENT_REMINDER_QUEUE,
  MEDICINE_EXPIRY_SCAN_QUEUE,
  PRESCRIPTION_PDF_QUEUE,
} from "./queue.constants";
import { AppointmentReminderQueueService } from "./appointment-reminder-queue.service";
import { AppointmentReminderProcessor } from "./appointment-reminder.processor";
import { PrescriptionPdfQueueService } from "./prescription-pdf-queue.service";
import { PrescriptionPdfProcessor } from "./prescription-pdf.processor";
import { MedicinesModule } from "../medicines/medicines.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { MedicineExpiryScanProcessor } from "./medicine-expiry-scan.processor";
import { MedicineExpiryScanScheduler } from "./medicine-expiry-scan.scheduler";
import { parseRedisConnection } from "./redis-connection.util";

/**
 * BullMQ needs its own Redis connection, never the shared `REDIS_CLIENT`
 * from `RedisModule` — BullMQ requires `maxRetriesPerRequest: null` on the
 * connection it uses (it issues blocking commands and manages its own retry
 * behavior; a finite `maxRetriesPerRequest` — set to `3` on the shared
 * client for the throttler's use case — makes BullMQ throw at startup).
 * Parsed from the same `REDIS_URL` as everywhere else, just a distinct
 * connection — see `redis-connection.util.ts` for why this can't just hand
 * BullMQ the URL string the way `new Redis(url)` elsewhere does.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: parseRedisConnection(config.getOrThrow<string>("REDIS_URL")),
      }),
    }),
    BullModule.registerQueue({
      name: APPOINTMENT_REMINDER_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 7 * 24 * 60 * 60 },
        removeOnFail: { age: 30 * 24 * 60 * 60 },
      },
    }),
    // docs/03-ARCHITECTURE.md §12: 2 attempts, no backoff config specified
    // there — a flat retry is enough for a deterministic render step (no
    // external API rate limits to back off from, unlike email/SMS).
    BullModule.registerQueue({
      name: PRESCRIPTION_PDF_QUEUE,
      defaultJobOptions: {
        attempts: 2,
        removeOnComplete: { age: 7 * 24 * 60 * 60 },
        removeOnFail: { age: 30 * 24 * 60 * 60 },
      },
    }),
    // docs/03-ARCHITECTURE.md §12: "N/A (idempotent scan)" — the scan is
    // date-scoped and safe to re-run, so a couple of spaced retries only
    // cover transient DB/Redis blips; the next night catches up anything else.
    BullModule.registerQueue({
      name: MEDICINE_EXPIRY_SCAN_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: { age: 30 * 24 * 60 * 60 },
        removeOnFail: { age: 30 * 24 * 60 * 60 },
      },
    }),
    MedicinesModule,
    NotificationsModule,
  ],
  providers: [
    AppointmentReminderQueueService,
    AppointmentReminderProcessor,
    PrescriptionPdfQueueService,
    PrescriptionPdfProcessor,
    MedicineExpiryScanProcessor,
    MedicineExpiryScanScheduler,
  ],
  exports: [
    AppointmentReminderQueueService,
    PrescriptionPdfQueueService,
    MedicineExpiryScanScheduler,
  ],
})
export class QueueModule {}
