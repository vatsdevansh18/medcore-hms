import { Controller, Get, Query } from "@nestjs/common";
import { UserRole } from "@medcore/types";
import { Roles } from "../auth/decorators/roles.decorator";
import { BypassTenantScope } from "../auth/decorators/bypass-tenant-scope.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { AnalyticsService } from "./analytics.service";
import { SearchService, SEARCH_ROLES } from "./search.service";
import { AuditLogsService } from "./audit-logs.service";
import { DateRangeQueryDto } from "./dto/date-range-query.dto";
import { SearchQueryDto } from "./dto/search-query.dto";
import { FindAuditLogsQueryDto } from "./dto/find-audit-logs-query.dto";

/** docs/07-RBAC-MATRIX.md §3.1 analytics rows, D-040. Super Admin's
 * platform-wide view is the documented `@BypassTenantScope()` path. */
@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Roles(UserRole.SUPER_ADMIN, UserRole.HOSPITAL_ADMIN)
  @BypassTenantScope()
  @Get("overview")
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.analytics.overview(user);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.HOSPITAL_ADMIN, UserRole.DOCTOR)
  @BypassTenantScope()
  @Get("appointments")
  appointments(@Query() query: DateRangeQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.analytics.appointments(query, user);
  }

  /** "Hospital-level analytics": Accountant is "own, financial only". */
  @Roles(UserRole.SUPER_ADMIN, UserRole.HOSPITAL_ADMIN, UserRole.ACCOUNTANT)
  @BypassTenantScope()
  @Get("revenue")
  revenue(@Query() query: DateRangeQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.analytics.revenue(query, user);
  }

  /** Nurse: "read/update bed status only" (§3.1 rooms/beds row). */
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.NURSE)
  @Get("occupancy")
  occupancy(@CurrentUser() user: AuthenticatedUser) {
    return this.analytics.occupancy(user);
  }
}

@Controller("search")
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Roles(...SEARCH_ROLES)
  @Get()
  find(@Query() query: SearchQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.search.search(query, user);
  }
}

@Controller("audit-logs")
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  @Roles(UserRole.SUPER_ADMIN, UserRole.HOSPITAL_ADMIN)
  @BypassTenantScope()
  @Get()
  findAll(@Query() query: FindAuditLogsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.auditLogs.findAll(query, user);
  }
}
