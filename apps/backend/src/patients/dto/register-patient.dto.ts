import { Type } from "class-transformer";
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Gender } from "@medcore/types";
import { AddressDto } from "../../hospitals/dto/address.dto";

/** POST /patients — front-desk (Receptionist/Hospital Admin) registration.
 * Distinct from POST /auth/register (public self-registration): this always
 * creates an ACTIVE, pre-verified account (staff is present in person to
 * confirm identity) and, like staff provisioning, sends a password-setup
 * link rather than staff setting/knowing the patient's password. */
export class RegisterPatientDto {
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

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsIn(Object.values(Gender))
  gender?: Gender;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  bloodGroup?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  emergencyContactName?: string;

  @IsOptional()
  @IsPhoneNumber()
  emergencyContactPhone?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;
}
