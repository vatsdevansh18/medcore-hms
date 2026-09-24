import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationDispatcher } from "./notification-dispatcher.service";
import { ChannelDeliveryService } from "./channel-delivery.service";
import { EmailProcessor, InAppProcessor, SmsProcessor } from "./channel.processors";
import { NotificationOutboxScheduler, NotificationOutboxSweepProcessor } from "./notification-outbox.sweep";
import { NotificationsGateway } from "./realtime/notifications.gateway";
import { EMAIL_QUEUE, IN_APP_QUEUE, NOTIFICATION_OUTBOX_QUEUE, SMS_QUEUE } from "./notification.constants";

/**
 * Phase 11: notifications and their background delivery
 * (docs/03-ARCHITECTURE.md §7/§12, docs/11-DECISIONS.md D-032). Retry and
 * retention options are set per job by the dispatcher, so the channel
 * queues are registered bare. The BullMQ root connection is configured in
 * `QueueModule`, whose `forRootAsync` is global.
 */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: EMAIL_QUEUE },
      { name: SMS_QUEUE },
      { name: IN_APP_QUEUE },
      { name: NOTIFICATION_OUTBOX_QUEUE },
    ),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationDispatcher,
    ChannelDeliveryService,
    EmailProcessor,
    SmsProcessor,
    InAppProcessor,
    NotificationOutboxScheduler,
    NotificationOutboxSweepProcessor,
    NotificationsGateway,
  ],
  exports: [NotificationsService, NotificationDispatcher],
})
export class NotificationsModule {}
