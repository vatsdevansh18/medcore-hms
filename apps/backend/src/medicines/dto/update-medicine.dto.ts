import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { MedicineForm } from "@medcore/types";

/** `PATCH /medicines/:id` — every field optional; changing `reorderLevel`
 * re-evaluates the low-stock latch (FR-PHARM-004), since raising the
 * threshold above current stock is itself a crossing. */
export class UpdateMedicineDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  genericName?: string;

  @IsOptional()
  @IsEnum(MedicineForm)
  form?: MedicineForm;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  manufacturer?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unit?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  reorderLevel?: number;
}
