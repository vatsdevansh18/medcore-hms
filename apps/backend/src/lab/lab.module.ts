import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { BillingModule } from "../billing/billing.module";
import { LabController } from "./lab.controller";
import { LabService } from "./lab.service";

@Module({
  imports: [AuthModule, BillingModule, NotificationsModule],
  controllers: [LabController],
  providers: [LabService],
})
export class LabModule {}
