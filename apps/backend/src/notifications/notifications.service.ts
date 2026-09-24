import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { NotificationChannel, type NotificationType, type NotificationView } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { PaginatedResult } from "../common/pagination/paginated-result";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { NOTIFICATION_TRIGGERS } from "./notification-triggers";
import { NOTIFICATIONS_COMMITTED_EVENT } from "./notification.constants";
import type { FindNotificationsQueryDto } from "./dto/find-notifications-query.dto";

/** Any client that exposes `notification`: the root client or a caller's
 * interactive-transaction client (same pattern as `BillingDb`/`PharmacyDb`). */
export type NotificationDb = Pick<ExtendedPrismaClient, "notification">;

export interface NotificationEvent {
  type: NotificationType;
  hospitalId: string | null;
  /** Nulls are dropped: e.g. a patient without a portal account. */
  recipientUserIds: (string | null | undefined)[];
  title: string;
  body: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  /** Identifies this occurrence of the event. Combined with each recipient
   * it becomes `Notification.dedupeKey`, so recording the same event twice
   * (a retried request, a concurrent duplicate, a re-run job) is a no-op. */
  dedupeKey: string;
}

const VIEW_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  relatedEntityType: true,
  relatedEntityId: true,
  readAt: true,
  createdAt: true,
} as const;

/**
 * FR-NOTIF-001..003, docs/11-DECISIONS.md D-032 (transactional outbox).
 *
 * `record()` is how every domain service raises a notification event: it
 * writes one `Notification` row per recipient *inside the caller's own
 * transaction*, so the notification exists if and only if the triggering
 * change committed. Channels come from the trigger table, never the caller.
 * Nothing is sent here. After its transaction commits, the caller calls
 * `publish()`, which signals the in-process event bus; the
 * `NotificationDispatcher` then enqueues one BullMQ job per channel. If that
 * signal is lost (crash between commit and publish), the outbox sweep
 * delivers the row anyway.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly events: EventEmitter2,
  ) {}

  async record(db: NotificationDb, event: NotificationEvent): Promise<number> {
    const recipients = [...new Set(event.recipientUserIds.filter((id): id is string => !!id))];
    if (recipients.length === 0) return 0;
    const { channels } = NOTIFICATION_TRIGGERS[event.type];
    const result = await db.notification.createMany({
      data: recipients.map((recipientUserId) => ({
        hospitalId: event.hospitalId,
        recipientUserId,
        type: event.type,
        title: event.title,
        body: event.body,
        channels,
        relatedEntityType: event.relatedEntityType ?? null,
        relatedEntityId: event.relatedEntityId ?? null,
        dedupeKey: `${event.dedupeKey}:${recipientUserId}`,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  /** Post-commit signal. Never throws: the domain change already committed,
   * and the sweep is the backstop (NFR-AVAIL-003). */
  publish(): void {
    try {
      this.events.emit(NOTIFICATIONS_COMMITTED_EVENT);
    } catch (err) {
      this.logger.error(`Notification publish signal failed (sweep will deliver): ${String(err)}`);
    }
  }

  /** `GET /notifications/me` (FR-NOTIF-003): the caller's own in-app
   * history. Scoped by `recipientUserId = caller.sub` on top of tenant
   * scoping, so no role or hospital can see anyone else's. */
  async findMine(query: FindNotificationsQueryDto, caller: AuthenticatedUser) {
    return TenantContext.runForCaller(caller, async () => {
      const where = {
        recipientUserId: caller.sub,
        channels: { has: NotificationChannel.IN_APP },
        ...(query.unreadOnly ? { readAt: null } : {}),
      };
      const [rows, total, unreadCount] = await Promise.all([
        this.prisma.notification.findMany({
          where,
          select: VIEW_SELECT,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: query.skip,
          take: query.limit,
        }),
        this.prisma.notification.count({ where }),
        this.prisma.notification.count({
          where: { recipientUserId: caller.sub, channels: { has: NotificationChannel.IN_APP }, readAt: null },
        }),
      ]);
      const page = PaginatedResult.of(rows.map(toView), total, query.page, query.limit);
      const meta = { ...page.meta, unreadCount };
      return new PaginatedResult(page.data, meta);
    });
  }

  /** `PATCH /notifications/:id/read`: owner only. Anyone else's id, or an
   * email/SMS-only row, is a 404, the same not-found-not-forbidden posture
   * as elsewhere. Idempotent: re-reading keeps the first `readAt`. */
  async markRead(id: string, caller: AuthenticatedUser): Promise<NotificationView> {
    return TenantContext.runForCaller(caller, async () => {
      const owned = { id, recipientUserId: caller.sub, channels: { has: NotificationChannel.IN_APP } };
      await this.prisma.notification.updateMany({ where: { ...owned, readAt: null }, data: { readAt: new Date() } });
      const row = await this.prisma.notification.findFirst({ where: owned, select: VIEW_SELECT });
      if (!row) throw new NotFoundException("Notification not found.");
      return toView(row);
    });
  }
}

export function toView(row: {
  id: string;
  type: string;
  title: string;
  body: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationView {
  // Explicit fields, never a spread: callers pass wider rows (the in-app
  // worker's includes the recipient's contact details, the dedupe key, and
  // the hospital id), and none of that may reach a client.
  return {
    id: row.id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    relatedEntityType: row.relatedEntityType,
    relatedEntityId: row.relatedEntityId,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
