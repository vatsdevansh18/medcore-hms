import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { PaginatedResult } from "../common/pagination/paginated-result";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import type { FindMedicinesQueryDto } from "./dto/find-medicines-query.dto";

/** Read-only catalog search this phase (docs/07-RBAC-MATRIX.md §3.7 "Search
 * medicine inventory" row) — creating/managing `Medicine`/`MedicineBatch`
 * rows is Phase 9's "Manage medicine catalog/batches" (Pharmacist-only)
 * deliverable, not yet built. */
@Injectable()
export class MedicinesService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  async findAll(query: FindMedicinesQueryDto, caller: AuthenticatedUser) {
    if (!caller.hospitalId) return PaginatedResult.of([], 0, query.page, query.limit);
    const hospitalId = caller.hospitalId;

    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      const where = {
        hospitalId,
        deletedAt: null,
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: "insensitive" as const } },
                { genericName: { contains: query.search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      };
      const [data, total] = await Promise.all([
        this.prisma.medicine.findMany({
          where,
          skip: query.skip,
          take: query.limit,
          orderBy: { name: "asc" },
        }),
        this.prisma.medicine.count({ where }),
      ]);
      return PaginatedResult.of(data, total, query.page, query.limit);
    });
  }

  async findOne(id: string, caller: AuthenticatedUser) {
    if (!caller.hospitalId) throw new NotFoundException("Medicine not found.");
    const medicine = await TenantContext.run(
      { hospitalId: caller.hospitalId, userId: caller.sub, bypassTenancy: false },
      () => this.prisma.medicine.findUnique({ where: { id } }),
    );
    if (!medicine) throw new NotFoundException("Medicine not found.");
    return medicine;
  }
}
