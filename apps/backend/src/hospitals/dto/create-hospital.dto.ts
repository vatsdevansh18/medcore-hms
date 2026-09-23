import { Type } from "class-transformer";
import {
  IsEmail,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { AddressDto } from "./address.dto";

export class CreateHospitalDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message:
      "slug must be lowercase alphanumeric segments separated by hyphens (e.g. city-hospital)",
  })
  @MinLength(2)
  @MaxLength(60)
  slug!: string;

  @IsEmail()
  contactEmail!: string;

  @IsOptional()
  @IsPhoneNumber()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;
}
