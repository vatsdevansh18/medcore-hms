import { IsDateString, IsInt, IsNumber, Matches, Max, Min } from "class-validator";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `POST /medicines/:id/batches` — FR-PHARM-001 batch-level stock receipt:
 * batch number, manufacturing date, expiry date, quantity on hand, unit
 * cost, MRP. Dates are calendar dates (`YYYY-MM-DD`), matching the `DATE`
 * columns they're stored in; `strict` rejects impossible dates like
 * 2026-02-30 that a bare pattern match would let through. */
export class ReceiveBatchDto {
  @Matches(/^[A-Za-z0-9][A-Za-z0-9/-]{0,49}$/, {
    message: "batchNumber must be 1-50 characters: letters, digits, '-' or '/'",
  })
  batchNumber!: string;

  @Matches(DATE_ONLY, { message: "manufacturingDate must be YYYY-MM-DD" })
  @IsDateString({ strict: true })
  manufacturingDate!: string;

  @Matches(DATE_ONLY, { message: "expiryDate must be YYYY-MM-DD" })
  @IsDateString({ strict: true })
  expiryDate!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;

  /** `Decimal(10,2)` columns — capped below the column's 99,999,999.99 max. */
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(9_999_999)
  unitCost!: number;

  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(9_999_999)
  mrp!: number;
}
