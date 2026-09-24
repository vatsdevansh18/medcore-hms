import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PaymentListView } from "@medcore/types";
import { PRISMA_CLIENT } from "../../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../../prisma/prisma-client.factory";
import { TenantContext } from "../../common/tenancy/tenant-context";
import { PaginatedResult } from "../../common/pagination/paginated-result";
import type { AuthenticatedUser } from "../../auth/interfaces/authenticated-user.interface";
import type { FindPaymentsQueryDto } from "../dto/find-payments-query.dto";

/**
 * `GET /payments`: the reconciliation queue (docs/07-RBAC-MATRIX.md §3.8
 * "Reconcile payments": Accountant, Hospital Admin read). Explicit fields
 * only: never the provider payload, provider reference, or verification flag.
 */
@Injectable()
export class PaymentsQueryService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  async findAll(query: FindPaymentsQueryDto, caller: AuthenticatedUser) {
    if (!caller.hospitalId) return PaginatedResult.of([], 0, query.page, query.limit);
    const hospitalId = caller.hospitalId;
    const where: Prisma.PaymentWhereInput = {
      hospitalId,
      ...(query.status ? { status: { in: query.status } } : {}),
      ...(query.method ? { method: { in: query.method } } : {}),
    };
    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      const [rows, total] = await Promise.all([
        this.prisma.payment.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: query.skip,
          take: query.limit,
          select: {
            id: true,
            invoiceId: true,
            method: true,
            amount: true,
            currency: true,
            status: true,
            createdAt: true,
            invoice: { select: { patient: { select: { user: { select: { id: true, firstName: true, lastName: true } } } } } },
          },
        }),
        this.prisma.payment.count({ where }),
      ]);
      const data: PaymentListView[] = rows.map((row) => ({
        id: row.id,
        invoiceId: row.invoiceId,
        method: row.method,
        amount: row.amount.toFixed(2),
        currency: row.currency,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        patient: row.invoice.patient.user,
      }));
      return PaginatedResult.of(data, total, query.page, query.limit);
    });
  }
}
