import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { APPOINTMENT_REMINDER_QUEUE } from "./queue.constants";
import { AppointmentReminderQueueService } from "./appointment-reminder-queue.service";
import { AppointmentReminderProcessor } from "./appointment-reminder.processor";
import { ReminderDeliveryStub, REMINDER_DELIVERY_PORT } from "./reminder-delivery.stub";

/**
 * BullMQ needs its own Redis connection, never the shared `REDIS_CLIENT`
 * from `RedisModule` — BullMQ requires `maxRetriesPerRequest: null` on the
 * connection it uses (it issues blocking commands and manages its own retry
 * behavior; a finite `maxRetriesPerRequest` — set to `3` on the shared
 * client for the throttler's use case — makes BullMQ throw at startup).
 * Parsed from the same `REDIS_URL` as everywhere else, just a distinct
 * connection.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.getOrThrow<string>("REDIS_URL"));
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            password: url.password || undefined,
            db: url.pathname ? Number(url.pathname.slice(1) || 0) : 0,
            maxRetriesPerRequest: null,
          },
        };
      },
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
  ],
  providers: [
    AppointmentReminderQueueService,
    AppointmentReminderProcessor,
    { provide: REMINDER_DELIVERY_PORT, useClass: ReminderDeliveryStub },
  ],
  exports: [AppointmentReminderQueueService],
})
export class QueueModule {}
