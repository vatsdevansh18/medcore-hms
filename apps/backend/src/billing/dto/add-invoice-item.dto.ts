import { IsIn, IsInt, IsNumber, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { InvoiceItemSourceType } from "@medcore/types";

/** Manual lines only: CONSULTATION/LAB/PHARMACY charges are created by the
 * system from the clinical record they bill for, never typed in by hand. */
export const MANUAL_ITEM_SOURCE_TYPES = [InvoiceItemSourceType.ROOM, InvoiceItemSourceType.OTHER] as const;

/**
 * `POST /invoices/:id/items`. A negative `unitPrice` is a credit line, the
 * only way to correct a finalized invoice (FR-BILL-002). There is no
 * `lineTotal`/`total` field: both are always computed server-side
 * (FR-BILL-003), and the global `forbidNonWhitelisted` pipe rejects a
 * client-supplied one with 400 rather than silently ignoring it.
 */
export class AddInvoiceItemDto {
  @IsIn(MANUAL_ITEM_SOURCE_TYPES)
  sourceType!: (typeof MANUAL_ITEM_SOURCE_TYPES)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  quantity!: number;

  /** Non-zero; bounded so `quantity × unitPrice` fits the Decimal(10,2) lineTotal. */
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(-99_999)
  @Max(99_999)
  unitPrice!: number;
}
