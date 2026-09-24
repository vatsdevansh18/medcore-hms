import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { PaginatedResult } from "../common/pagination/paginated-result";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import type { FindLabTestsQueryDto } from "./dto/find-lab-tests-query.dto";

@Injectable()
export class LabTestsService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  /** The caller's own hospital catalog, by name. `search` matches name or code. */
  async findAll(query: FindLabTestsQueryDto, caller: AuthenticatedUser) {
    if (!caller.hospitalId) return PaginatedResult.of([], 0, query.page, query.limit);
    const hospitalId = caller.hospitalId;
    const search = query.search?.trim();
    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      const where: Prisma.LabTestWhereInput = {
        hospitalId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { code: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const [data, total] = await Promise.all([
        this.prisma.labTest.findMany({
          where,
          orderBy: [{ name: "asc" }, { id: "asc" }],
          skip: query.skip,
          take: query.limit,
          select: {
            id: true,
            name: true,
            code: true,
            sampleType: true,
            price: true,
            turnaroundHours: true,
            referenceRanges: {
              orderBy: { id: "asc" },
              select: { id: true, gender: true, ageMin: true, ageMax: true, lowValue: true, highValue: true, unit: true },
            },
          },
        }),
        this.prisma.labTest.count({ where }),
      ]);
      return PaginatedResult.of(data, total, query.page, query.limit);
    });
  }
}
