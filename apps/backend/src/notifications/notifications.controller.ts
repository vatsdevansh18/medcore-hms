import { Controller, Get, Param, Patch, Query } from "@nestjs/common";
import { UserRole } from "@medcore/types";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { NotificationsService } from "./notifications.service";
import { FindNotificationsQueryDto } from "./dto/find-notifications-query.dto";

/** docs/07-RBAC-MATRIX.md §3.9 "View own notifications": every role. The
 * "own" part is enforced in the service (recipient = caller), not by role. */
const ALL_ROLES = Object.values(UserRole);

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Roles(...ALL_ROLES)
  @Get("me")
  findMine(@Query() query: FindNotificationsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.findMine(query, user);
  }

  @Roles(...ALL_ROLES)
  @Patch(":id/read")
  markRead(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markRead(id, user);
  }
}
