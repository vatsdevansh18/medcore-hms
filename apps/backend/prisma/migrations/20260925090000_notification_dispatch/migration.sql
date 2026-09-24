-- Phase 11: notification dispatch (docs/11-DECISIONS.md D-032).

-- AlterEnum
ALTER TYPE "NotificationStatus" ADD VALUE 'SKIPPED';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "dispatchedAt" TIMESTAMP(3);

-- Rows written before Phase 11 were never meant to be sent; mark them
-- dispatched so the first outbox drain doesn't deliver a stale backlog.
UPDATE "Notification" SET "dispatchedAt" = "createdAt" WHERE "dispatchedAt" IS NULL;

-- AlterTable
ALTER TABLE "NotificationDeliveryLog" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "providerMessageId" TEXT;

-- DropIndex
DROP INDEX "Notification_recipientUserId_idx";

-- DropIndex
DROP INDEX "NotificationDeliveryLog_notificationId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_createdAt_idx" ON "Notification"("recipientUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_dispatchedAt_createdAt_idx" ON "Notification"("dispatchedAt", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDeliveryLog_notificationId_channel_idx" ON "NotificationDeliveryLog"("notificationId", "channel");

-- DropForeignKey
ALTER TABLE "NotificationDeliveryLog" DROP CONSTRAINT "NotificationDeliveryLog_notificationId_fkey";

-- AddForeignKey
ALTER TABLE "NotificationDeliveryLog" ADD CONSTRAINT "NotificationDeliveryLog_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
