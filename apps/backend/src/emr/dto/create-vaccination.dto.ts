import { Type } from "class-transformer";
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

/** `POST /patients/:id/vaccinations` — FR-EMR-005. */
export class CreateVaccinationDto {
  @IsString()
  @MaxLength(200)
  vaccineName!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  doseNumber!: number;

  @IsDateString()
  dateAdministered!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  batchNumber?: string;

  @IsOptional()
  @IsDateString()
  nextDueDate?: string;
}
