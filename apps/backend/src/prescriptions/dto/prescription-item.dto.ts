import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";
import { PrescriptionFrequency } from "@medcore/types";

export class PrescriptionItemDto {
  @IsUUID()
  medicineId!: string;

  @IsString()
  @MaxLength(200)
  dosage!: string;

  @IsEnum(PrescriptionFrequency)
  frequency!: PrescriptionFrequency;

  @IsInt()
  @Min(1)
  @Max(365)
  durationDays!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  specialInstructions?: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  quantityPrescribed!: number;
}
