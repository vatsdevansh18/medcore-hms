import { IsEnum } from "class-validator";
import { PaymentProvider } from "@medcore/types";

/** `POST /invoices/:id/checkout-session`. No amount field: the amount is
 * always the server-computed balance due (docs/03-ARCHITECTURE.md §9). */
export class CheckoutSessionDto {
  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;
}
