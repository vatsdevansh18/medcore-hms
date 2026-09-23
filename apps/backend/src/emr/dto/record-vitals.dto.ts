import { Type } from "class-transformer";
import { IsInt, IsNumber, IsOptional, Max, Min } from "class-validator";

/** `POST /medical-records/:id/vitals` — FR-EMR-003. `bmi` is deliberately
 * absent: it is always server-computed from height/weight, never accepted
 * from the client. */
export class RecordVitalsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(40)
  @Max(300)
  bpSystolic?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(20)
  @Max(200)
  bpDiastolic?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(20)
  @Max(250)
  pulse?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(25)
  @Max(45)
  temperatureC?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  spo2?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(20)
  @Max(272)
  heightCm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(500)
  weightKg?: number;
}
