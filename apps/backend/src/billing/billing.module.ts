import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ChargesService } from "./charges.service";
import { InvoiceLedgerService } from "./invoice-ledger.service";
import { InvoicesService } from "./invoices.service";
import { InvoicesController } from "./invoices.controller";
import { PaymentsService } from "./payments/payments.service";
import { PaymentWebhooksController } from "./payments/payment-webhooks.controller";
import { PaymentsController } from "./payments/payments.controller";
import { ReceiptsService } from "./payments/receipts.service";
import { CheckoutClient } from "./payments/checkout-client";
import { PaymentWebhookVerifier } from "./payments/payment-webhook-verifier";

/** docs/03-ARCHITECTURE.md's BillingModule: invoices, charges, payments.
 * `ChargesService` is exported so clinical modules (EMR, Lab, Pharmacy) can
 * add charges inside their own transactions (FR-BILL-001). */
@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [InvoicesController, PaymentWebhooksController, PaymentsController],
  providers: [
    ChargesService,
    InvoiceLedgerService,
    InvoicesService,
    PaymentsService,
    CheckoutClient,
    PaymentWebhookVerifier,
    ReceiptsService,
  ],
  exports: [ChargesService],
})
export class BillingModule {}
