import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { UserRole } from "@medcore/types";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { InvoicesService } from "./invoices.service";
import { PaymentsService } from "./payments/payments.service";
import { CreateInvoiceDto } from "./dto/create-invoice.dto";
import { AddInvoiceItemDto } from "./dto/add-invoice-item.dto";
import { CashPaymentDto } from "./dto/cash-payment.dto";
import { CheckoutSessionDto } from "./dto/checkout-session.dto";
import { FindInvoicesQueryDto } from "./dto/find-invoices-query.dto";

/** docs/07-RBAC-MATRIX.md §3.8. Hospital Admin's 🟡 is read-only. */
const BILLING_STAFF: UserRole[] = [UserRole.RECEPTIONIST, UserRole.ACCOUNTANT];
const INVOICE_STAFF_VIEW_ROLES: UserRole[] = [...BILLING_STAFF, UserRole.HOSPITAL_ADMIN];
/** Patients list and view their own non-DRAFT invoices (FR-PORTAL-001, D-035). */
const INVOICE_VIEW_ROLES: UserRole[] = [...INVOICE_STAFF_VIEW_ROLES, UserRole.PATIENT];

@Controller("invoices")
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Roles(...BILLING_STAFF)
  @Post()
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.create(dto, user);
  }

  @Roles(...INVOICE_VIEW_ROLES)
  @Get()
  findAll(@Query() query: FindInvoicesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.findAll(query, user);
  }

  @Roles(...INVOICE_VIEW_ROLES)
  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.findOne(id, user);
  }

  @Roles(...BILLING_STAFF)
  @Post(":id/items")
  addItem(@Param("id") id: string, @Body() dto: AddInvoiceItemDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.addItem(id, dto, user);
  }

  @Roles(...BILLING_STAFF)
  @Patch(":id/finalize")
  finalize(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.finalize(id, user);
  }

  /** §3.8 "Initiate payment": Receptionist 🟡 cash only, Accountant 🟡 cash/reconciliation. */
  @Roles(...BILLING_STAFF)
  @Post(":id/cash-payment")
  cashPayment(@Param("id") id: string, @Body() dto: CashPaymentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.recordCash(id, dto, user);
  }

  /** §3.8 "Initiate payment": Patient, self only (online). */
  @Roles(UserRole.PATIENT)
  @Post(":id/checkout-session")
  checkoutSession(
    @Param("id") id: string,
    @Body() dto: CheckoutSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentsService.createCheckoutSession(id, dto, user);
  }
}
