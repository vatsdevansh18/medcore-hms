import { HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ApiErrorCode, InvoiceStatus, UserRole } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { AppException } from "../common/errors/app-exception";
import { PaginatedResult } from "../common/pagination/paginated-result";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { ChargesService, type BillingDb } from "./charges.service";
import { NotificationsService } from "../notifications/notifications.service";
import { InvoiceLedgerService } from "./invoice-ledger.service";
import type { CreateInvoiceDto } from "./dto/create-invoice.dto";
import type { AddInvoiceItemDto } from "./dto/add-invoice-item.dto";
import type { FindInvoicesQueryDto } from "./dto/find-invoices-query.dto";

export const INVOICE_INCLUDE = {
  items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  payments: {
    orderBy: { createdAt: "asc" },
    // Never the raw provider payload or internal verification flags.
    select: {
      id: true,
      method: true,
      amount: true,
      currency: true,
      status: true,
      createdAt: true,
    },
  },
} satisfies Prisma.InvoiceInclude;

const CREDITABLE_STATUSES: string[] = [InvoiceStatus.DRAFT, InvoiceStatus.FINALIZED, InvoiceStatus.PARTIALLY_PAID];

export function invoiceLocked(message: string): AppException {
  return new AppException(ApiErrorCode.INVOICE_LOCKED, message, HttpStatus.CONFLICT);
}

/** FR-BILL-001/002/003 invoice lifecycle, docs/07-RBAC-MATRIX.md §3.8. */
@Injectable()
export class InvoicesService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly charges: ChargesService,
    private readonly ledger: InvoiceLedgerService,
    private readonly notifications: NotificationsService,
  ) {}

  private requireHospitalId(caller: AuthenticatedUser): string {
    if (!caller.hospitalId) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "A hospital-scoped account is required for billing.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return caller.hospitalId;
  }

  private scoped<T>(caller: AuthenticatedUser, hospitalId: string, fn: () => Promise<T>): Promise<T> {
    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, fn);
  }

  /** The invoice with its lines, payments, and derived paid/balance figures. */
  async view(db: BillingDb, invoiceId: string) {
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: INVOICE_INCLUDE });
    const balance = await this.ledger.balance(db, invoiceId);
    return { ...invoice, amountPaid: balance.amountPaid, balanceDue: balance.balanceDue };
  }

  async create(dto: CreateInvoiceDto, caller: AuthenticatedUser) {
    const hospitalId = this.requireHospitalId(caller);
    return this.scoped(caller, hospitalId, () =>
      this.prisma.$transaction(async (tx) => {
        const invoiceId = await this.charges.getOrCreateDraftInvoice(tx, hospitalId, dto.appointmentId);
        return this.view(tx, invoiceId);
      }),
    );
  }

  async addItem(invoiceId: string, dto: AddInvoiceItemDto, caller: AuthenticatedUser) {
    const hospitalId = this.requireHospitalId(caller);
    if (dto.unitPrice === 0) {
      throw new AppException(ApiErrorCode.VALIDATION_ERROR, "unitPrice must be non-zero.", HttpStatus.BAD_REQUEST);
    }
    const lineTotal = new Prisma.Decimal(dto.unitPrice).mul(dto.quantity);

    return this.scoped(caller, hospitalId, () =>
      this.prisma.$transaction(async (tx) => {
        if (!(await this.charges.lockInvoice(tx, hospitalId, invoiceId))) {
          throw new NotFoundException("Invoice not found.");
        }
        const before = await this.ledger.balance(tx, invoiceId);

        if (lineTotal.lt(0)) {
          // A credit (FR-BILL-002 corrections). It can't take the total
          // below what's already been paid (that would need a refund, which
          // is out of scope) or below zero.
          if (!CREDITABLE_STATUSES.includes(before.status)) {
            throw invoiceLocked(`A ${before.status} invoice can't be credited.`);
          }
          const newTotal = before.total.add(lineTotal);
          if (newTotal.lt(0) || newTotal.lt(before.amountPaid)) {
            throw new AppException(
              ApiErrorCode.VALIDATION_ERROR,
              "This credit would reduce the invoice total below the amount already paid (or below zero).",
              HttpStatus.UNPROCESSABLE_ENTITY,
              { total: before.total.toFixed(2), amountPaid: before.amountPaid.toFixed(2) },
            );
          }
        } else if (before.status !== InvoiceStatus.DRAFT) {
          throw invoiceLocked(
            `This invoice is ${before.status}; its line items are immutable. Use a credit line to correct it.`,
          );
        }

        await this.charges.insertItem(tx, invoiceId, {
          sourceType: dto.sourceType,
          sourceId: null,
          description: dto.description,
          quantity: dto.quantity,
          unitPrice: dto.unitPrice,
        });
        await this.charges.recomputeTotals(tx, invoiceId);
        if (before.status !== InvoiceStatus.DRAFT) {
          // A credit can settle an invoice outright (e.g. PARTIALLY_PAID -> PAID).
          await this.ledger.applyPaymentStatus(tx, invoiceId);
        }
        return this.view(tx, invoiceId);
      }),
    );
  }

  /** FR-BILL-002: DRAFT -> FINALIZED. A zero-total invoice (everything
   * credited) has nothing to collect, so it goes straight to PAID. */
  async finalize(invoiceId: string, caller: AuthenticatedUser) {
    const hospitalId = this.requireHospitalId(caller);
    const view = await this.scoped(caller, hospitalId, () =>
      this.prisma.$transaction(async (tx) => {
        if (!(await this.charges.lockInvoice(tx, hospitalId, invoiceId))) {
          throw new NotFoundException("Invoice not found.");
        }
        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { id: invoiceId },
          include: { _count: { select: { items: true } } },
        });
        if (invoice.status !== InvoiceStatus.DRAFT) {
          throw invoiceLocked(`Only a DRAFT invoice can be finalized; this one is ${invoice.status}.`);
        }
        if (invoice._count.items === 0) {
          throw new AppException(
            ApiErrorCode.VALIDATION_ERROR,
            "An invoice with no line items can't be finalized.",
            HttpStatus.BAD_REQUEST,
          );
        }
        // Defense in depth: the stored total must still equal the items'
        // sum. The DB trigger guarantees this at commit, but finalizing is
        // the moment the amount becomes binding.
        await this.charges.recomputeTotals(tx, invoiceId);
        const finalized = await tx.invoice.update({
          where: { id: invoiceId },
          data: { status: InvoiceStatus.FINALIZED, finalizedBy: caller.sub, finalizedAt: new Date() },
          include: { patient: { select: { userId: true } } },
        });
        await this.ledger.applyPaymentStatus(tx, invoiceId);
        await this.ledger.notifyInvoiceGenerated(tx, {
          hospitalId,
          invoiceId,
          patientUserId: finalized.patient.userId,
          total: finalized.total,
          currency: finalized.currency,
        });
        return this.view(tx, invoiceId);
      }),
    );
    this.notifications.publish();
    return view;
  }

  async findOne(invoiceId: string, caller: AuthenticatedUser) {
    const hospitalId = caller.hospitalId;
    if (!hospitalId) throw new NotFoundException("Invoice not found.");
    return this.scoped(caller, hospitalId, async () => {
      const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) throw new NotFoundException("Invoice not found.");
      if (caller.role === UserRole.PATIENT) {
        // docs/07-RBAC-MATRIX.md §3.8 "self only": another patient's
        // invoice is indistinguishable from a missing one.
        const own = await this.prisma.patientProfile.findUnique({ where: { userId: caller.sub } });
        if (!own || own.id !== invoice.patientId) throw new NotFoundException("Invoice not found.");
      }
      return this.view(this.prisma, invoiceId);
    });
  }

  async findAll(query: FindInvoicesQueryDto, caller: AuthenticatedUser) {
    const hospitalId = this.requireHospitalId(caller);
    return this.scoped(caller, hospitalId, async () => {
      const where = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.patientId ? { patientId: query.patientId } : {}),
        ...(query.appointmentId ? { appointmentId: query.appointmentId } : {}),
      };
      const [data, total] = await Promise.all([
        this.prisma.invoice.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: query.skip,
          take: query.limit,
        }),
        this.prisma.invoice.count({ where }),
      ]);
      return PaginatedResult.of(data, total, query.page, query.limit);
    });
  }
}
