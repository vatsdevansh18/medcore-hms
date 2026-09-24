import { Module } from "@nestjs/common";
import { AnalyticsController, AuditLogsController, SearchController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { SearchService } from "./search.service";
import { AuditLogsService } from "./audit-logs.service";

/** docs/03-ARCHITECTURE.md §3 AnalyticsModule/AuditModule reads (Phase 13):
 * dashboards, global search, and the audit trail. Read-only by design. */
@Module({
  controllers: [AnalyticsController, SearchController, AuditLogsController],
  providers: [AnalyticsService, SearchService, AuditLogsService],
})
export class AnalyticsModule {}
