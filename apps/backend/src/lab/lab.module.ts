import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { BillingModule } from "../billing/billing.module";
import { LabController } from "./lab.controller";
import { LabService } from "./lab.service";
import { LabTestsController } from "./lab-tests.controller";
import { LabTestsService } from "./lab-tests.service";

@Module({
  imports: [AuthModule, BillingModule, NotificationsModule],
  controllers: [LabController, LabTestsController],
  providers: [LabService, LabTestsService],
})
export class LabModule {}
