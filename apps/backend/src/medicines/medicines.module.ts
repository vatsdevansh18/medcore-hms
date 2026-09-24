import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BillingModule } from "../billing/billing.module";
import { MedicinesController } from "./medicines.controller";
import { MedicinesService } from "./medicines.service";
import { DispensingController } from "./dispensing.controller";
import { DispensingService } from "./dispensing.service";
import { StockService } from "./stock.service";
import { ExpiryScanService } from "./expiry-scan.service";
import { NotificationsModule } from "../notifications/notifications.module";

/** Pharmacy (docs/03-ARCHITECTURE.md's "PharmacyModule"): catalog, batch
 * inventory, dispensing, stock alerts, and the expiry scan. Started as the
 * read-only medicine search in Phase 7 (docs/11-DECISIONS.md D-017). */
@Module({
  imports: [AuthModule, BillingModule, NotificationsModule],
  controllers: [MedicinesController, DispensingController],
  providers: [
    MedicinesService,
    DispensingService,
    StockService,
    ExpiryScanService,
  ],
  exports: [MedicinesService, ExpiryScanService],
})
export class MedicinesModule {}
