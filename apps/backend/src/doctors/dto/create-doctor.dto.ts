import { Type } from "class-transformer";
import {
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

/** POST /doctors — creates the User (role=DOCTOR) and DoctorProfile atomically.
 * FR-HOSP-003: specialization, licence number, qualification, consultation
 * fee, and (added later, via a dedicated upload) a signature asset. */
export class CreateDoctorDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @IsOptional()
  @IsPhoneNumber()
  phone?: string;

  @IsUUID()
  departmentId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  specialization!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  licenseNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  qualification?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(70)
  yearsOfExperience?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  consultationFee!: number;
}
