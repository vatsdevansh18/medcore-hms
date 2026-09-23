import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/** `POST /patients/:id/allergies` — FR-EMR-005 (patient-level, persists across encounters). */
export class CreateAllergyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  allergen!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reaction?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  severity?: string;
}
