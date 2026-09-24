import { IsNumber, Max, Min } from "class-validator";

/** `POST /invoices/:id/cash-payment`: full or partial (FR-BILL-006). The
 * amount can't exceed the balance due; change is handled at the counter. */
export class CashPaymentDto {
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(9_999_999)
  amount!: number;
}
