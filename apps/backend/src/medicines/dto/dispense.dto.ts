import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export class DispenseItemDto {
  @IsUUID()
  prescriptionItemId!: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  quantity!: number;

  /**
   * Optional physical-pick check: the batch the pharmacist actually has in
   * hand. If given, the whole quantity must come from that batch, and it
   * must be the batch FEFO selection would choose anyway — an expired,
   * quarantined, exhausted, or out-of-order batch is rejected with a
   * validation error, never silently swapped for another one (FR-PHARM-002/003).
   * If omitted, the server picks batches FEFO, splitting across batches
   * when needed.
   */
  @IsOptional()
  @IsUUID()
  batchId?: string;
}

/** `POST /prescriptions/:id/dispense` — FR-PHARM-002/003. Partial
 * dispensing is supported; the whole request is atomic. */
export class DispenseDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DispenseItemDto)
  items!: DispenseItemDto[];
}
