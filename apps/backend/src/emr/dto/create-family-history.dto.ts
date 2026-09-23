import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { FamilyHistoryCondition } from "@medcore/types";

/** `POST /patients/:id/family-history` — FR-EMR-005. */
export class CreateFamilyHistoryDto {
  @IsEnum(FamilyHistoryCondition)
  condition!: FamilyHistoryCondition;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
