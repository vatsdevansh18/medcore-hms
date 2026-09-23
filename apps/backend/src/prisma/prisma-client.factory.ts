import { PrismaClient } from "@prisma/client";
import { tenantScopingExtension } from "../common/tenancy/tenant-scoping.extension";
import { auditLogExtension } from "../common/audit/audit-log.extension";

/**
 * Order matters: tenant scoping must apply before audit logging, so that the
 * audit extension's internal auxiliary queries (writing AuditLog rows,
 * reading pre-update state) are themselves correctly tenant-scoped rather
 * than bypassing it. See src/common/audit/audit-log.extension.ts.
 */
export function createPrismaClient(databaseUrl: string) {
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  })
    .$extends(tenantScopingExtension)
    .$extends(auditLogExtension);
}

export type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;
