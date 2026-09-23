import { SetMetadata } from "@nestjs/common";
import { UserRole } from "@medcore/types";

export const ROLES_KEY = "roles";

/**
 * Every protected route must carry this decorator explicitly — SEC-AUTHZ-001
 * requires deny-by-default, so a route with no @Roles() (and no @Public())
 * is rejected by RolesGuard rather than silently allowed. For a route any
 * authenticated role may use (e.g. GET /auth/me), spread ALL_ROLES rather
 * than omitting the decorator.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const ALL_ROLES: UserRole[] = Object.values(UserRole);
