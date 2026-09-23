import { SetMetadata } from "@nestjs/common";

export const BYPASS_TENANT_SCOPE_KEY = "bypassTenantScope";

/**
 * Marks a route where a SUPER_ADMIN caller may operate without hospitalId
 * scoping — docs/03-ARCHITECTURE.md §5. Has no effect for any other role;
 * TenantContextInterceptor only honours this when `user.role === SUPER_ADMIN`.
 * An unmarked route stays tenant-scoped even for a Super Admin.
 */
export const BypassTenantScope = () => SetMetadata(BYPASS_TENANT_SCOPE_KEY, true);
