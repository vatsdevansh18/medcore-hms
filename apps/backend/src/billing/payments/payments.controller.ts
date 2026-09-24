import { Controller, Get, Param, Query } from "@nestjs/common";
import { UserRole } from "@medcore/types";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/interfaces/authenticated-user.interface";
import { RECEIPT_ROLES, ReceiptsService } from "./receipts.service";
import { PaymentsQueryService } from "./payments-query.service";
import { FindPaymentsQueryDto } from "../dto/find-payments-query.dto";

@Controller("payments")
export class PaymentsController {
  constructor(
    private readonly receipts: ReceiptsService,
    private readonly payments: PaymentsQueryService,
  ) {}

  /** Reconciliation queue (§3.8): Accountant, Hospital Admin (read). */
  @Roles(UserRole.ACCOUNTANT, UserRole.HOSPITAL_ADMIN)
  @Get()
  findAll(@Query() query: FindPaymentsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payments.findAll(query, user);
  }

  /** `{downloadUrl}` for a SUCCEEDED payment's receipt PDF (409 otherwise). */
  @Roles(...RECEIPT_ROLES)
  @Get(":id/receipt")
  receipt(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.receipts.getReceiptUrl(id, user);
  }
}
