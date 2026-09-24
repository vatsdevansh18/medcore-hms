import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { UserRole, type AuditLogView } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { PaginatedResult } from "../common/pagination/paginated-result";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import type { FindAuditLogsQueryDto } from "./dto/find-audit-logs-query.dto";

/**
 * `GET /audit-logs` (docs/07-RBAC-MATRIX.md §3.9, SEC-AUDIT-002): a Hospital
 * Admin sees their own hospital's trail, a Super Admin the whole platform.
 * Only who did what to which record and when: `beforeData`/`afterData` can
 * hold clinical ciphertext and personal fields, and are never returned.
 */
@Injectable()
export class AuditLogsService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  async findAll(query: FindAuditLogsQueryDto, caller: AuthenticatedUser) {
    const platform = caller.role === UserRole.SUPER_ADMIN;
    if (!platform && !caller.hospitalId) return PaginatedResult.of([], 0, query.page, query.limit);

    const where: Prisma.AuditLogWhereInput = {
      ...(platform ? {} : { hospitalId: caller.hospitalId }),
      ...(query.entityType ? { entityType: query.entityType } : {}),
    };
    const read = async () => {
      const [rows, total] = await Promise.all([
        this.prisma.auditLog.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: query.skip,
          take: query.limit,
          select: {
            id: true,
            action: true,
            entityType: true,
            entityId: true,
            hospitalId: true,
            createdAt: true,
            actor: { select: { id: true, firstName: true, lastName: true, role: true } },
          },
        }),
        this.prisma.auditLog.count({ where }),
      ]);
      const data: AuditLogView[] = rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        hospitalId: row.hospitalId,
        createdAt: row.createdAt.toISOString(),
        actor: row.actor,
      }));
      return PaginatedResult.of(data, total, query.page, query.limit);
    };
    return platform
      ? TenantContext.bypass(read)
      : TenantContext.run({ hospitalId: caller.hospitalId!, userId: caller.sub, bypassTenancy: false }, read);
  }
}
