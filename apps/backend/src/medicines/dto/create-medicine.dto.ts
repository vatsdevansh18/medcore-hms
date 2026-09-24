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

/** `POST /medicines` — FR-PHARM-001 catalog entry (docs/07-RBAC-MATRIX.md
 * §3.7 "Manage medicine catalog/batches"). Stock itself is never set here —
 * it only ever arrives as a batch via `POST /medicines/:id/batches`. */
export class CreateMedicineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  genericName?: string;

  @IsEnum(MedicineForm)
  form!: MedicineForm;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  manufacturer?: string;

  /** Dispensing unit (e.g. "tablet", "ml", "vial") — quantities everywhere
   * in pharmacy are counts of this unit. */
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unit!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  reorderLevel?: number;
}
