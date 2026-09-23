import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/** Reused wherever an Address is created inline (Hospital, PatientProfile) — docs/06-DATABASE-DESIGN.md §4. */
export class AddressDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  line1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  line2?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  city!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  state!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  postalCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  country!: string;
}
