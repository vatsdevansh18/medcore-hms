import { Inject, Injectable, Logger } from "@nestjs/common";
import { UnrecoverableError, type Job } from "bullmq";
import { NotificationChannel, NotificationStatus, UserStatus } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import {
  EMAIL_SENDER,
  PermanentDeliveryError,
  SMS_SENDER,
  type EmailSender,
  type SendResult,
  type SmsSender,
} from "../common/messaging/messaging.types";
import { MINIMAL_EXTERNAL_BODY, NOTIFICATION_TRIGGERS } from "./notification-triggers";
import type { ChannelJobData } from "./notification.constants";
import { NotificationsGateway } from "./realtime/notifications.gateway";
import { toView } from "./notifications.service";

const MAX_ERROR_LENGTH = 500;
const MAX_SMS_LENGTH = 600;
const EMAIL_FOOTER = "\n\n-- MedCore HMS. This is an automated message; replies are not monitored.";

/**
 * The per-channel worker body (EmailWorker / SmsWorker / PushWorker in
 * docs/03-ARCHITECTURE.md §7). Writes one `NotificationDeliveryLog` row per
 * attempt. SENT and SKIPPED are terminal. FAILED is retried by BullMQ
 * (3 attempts, exponential backoff), unless the provider rejected the
 * request itself, in which case retrying can't help and the job fails fast.
 */
@Injectable()
export class ChannelDeliveryService {
  private readonly logger = new Logger(ChannelDeliveryService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    private readonly gateway: NotificationsGateway,
  ) {}

  private load(notificationId: string) {
    return TenantContext.bypass(() =>
      this.prisma.notification.findUnique({
        where: { id: notificationId },
        include: {
          // Contact fields only (CLAUDE.md SAFE_USER_SELECT rule).
          recipient: {
            select: { id: true, email: true, phone: true, phoneVerifiedAt: true, status: true, deletedAt: true },
          },
        },
      }),
    );
  }

  async deliver(job: Job<ChannelJobData>): Promise<void> {
    const { notificationId, channel } = job.data;
    const attempt = job.attemptsMade + 1;

    const notification = await this.load(notificationId);
    if (!notification) {
      this.logger.warn(`${channel} job for notification ${notificationId}: the row no longer exists, skipping.`);
      return;
    }

    // Idempotent re-run: a job that already reached a terminal outcome
    // (e.g. re-added after its BullMQ record expired) does nothing.
    const done = await this.prisma.notificationDeliveryLog.findFirst({
      where: { notificationId, channel, status: { in: [NotificationStatus.SENT, NotificationStatus.SKIPPED] } },
      select: { id: true },
    });
    if (done) return;

    const recipient = notification.recipient;
    if (recipient.deletedAt || recipient.status === UserStatus.DISABLED) {
      await this.log(notificationId, channel, attempt, NotificationStatus.SKIPPED, null, "RECIPIENT_INACTIVE");
      return;
    }

    let result: SendResult;
    try {
      const outcome = await this.send(notification, channel);
      if (typeof outcome === "string") {
        await this.log(notificationId, channel, attempt, NotificationStatus.SKIPPED, null, outcome);
        return;
      }
      result = outcome;
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_LENGTH);
      await this.log(notificationId, channel, attempt, NotificationStatus.FAILED, null, message);
      this.logger.warn(`${channel} delivery of ${notificationId} failed (attempt ${attempt}): ${message}`);
      if (err instanceof PermanentDeliveryError) throw new UnrecoverableError(message);
      throw err;
    }
    await this.log(notificationId, channel, attempt, NotificationStatus.SENT, result);
  }

  /** Returns a skip reason, or the provider's send result. */
  private async send(
    n: NonNullable<Awaited<ReturnType<ChannelDeliveryService["load"]>>>,
    channel: NotificationChannel,
  ): Promise<SendResult | string> {
    const trigger = NOTIFICATION_TRIGGERS[n.type as keyof typeof NOTIFICATION_TRIGGERS];
    const minimal = trigger?.externalContent === "minimal";

    switch (channel) {
      case NotificationChannel.IN_APP:
        this.gateway.emitToUser(n.recipientUserId, toView(n));
        return { provider: "socket.io", providerMessageId: null, deliveredTo: `user:${n.recipientUserId}` };

      case NotificationChannel.EMAIL:
        if (!this.email.isConfigured()) return "PROVIDER_NOT_CONFIGURED";
        return this.email.send({
          to: n.recipient.email,
          subject: minimal ? "MedCore HMS: you have a new update" : `MedCore HMS: ${n.title}`,
          text: (minimal ? MINIMAL_EXTERNAL_BODY : n.body) + EMAIL_FOOTER,
          idempotencyKey: `${n.id}-EMAIL`,
        });

      case NotificationChannel.SMS: {
        // Only to a phone the user has proven they own (FR-AUTH-005), never
        // a number someone merely typed in (SEC-NOTIF-004).
        if (!n.recipient.phone) return "NO_PHONE";
        if (!n.recipient.phoneVerifiedAt) return "PHONE_NOT_VERIFIED";
        if (!this.sms.isConfigured()) return "PROVIDER_NOT_CONFIGURED";
        const text = minimal ? MINIMAL_EXTERNAL_BODY : `${n.title}. ${n.body}`;
        return this.sms.send({ to: n.recipient.phone, body: `MedCore HMS: ${text}`.slice(0, MAX_SMS_LENGTH) });
      }

      default:
        return "UNKNOWN_CHANNEL";
    }
  }

  private async log(
    notificationId: string,
    channel: NotificationChannel,
    attempt: number,
    status: NotificationStatus,
    result: SendResult | null,
    errorMessage?: string,
  ): Promise<void> {
    await this.prisma.notificationDeliveryLog.create({
      data: {
        notificationId,
        channel,
        attempt,
        status,
        provider: result?.provider ?? null,
        providerMessageId: result?.providerMessageId ?? null,
        errorMessage: errorMessage ?? null,
      },
    });
  }
}
