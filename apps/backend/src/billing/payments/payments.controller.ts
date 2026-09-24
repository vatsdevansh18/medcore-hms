import { Controller, Get, Param } from "@nestjs/common";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/interfaces/authenticated-user.interface";
import { RECEIPT_ROLES, ReceiptsService } from "./receipts.service";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly receipts: ReceiptsService) {}

  /** `{downloadUrl}` for a SUCCEEDED payment's receipt PDF (409 otherwise). */
  @Roles(...RECEIPT_ROLES)
  @Get(":id/receipt")
  receipt(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.receipts.getReceiptUrl(id, user);
  }
}
