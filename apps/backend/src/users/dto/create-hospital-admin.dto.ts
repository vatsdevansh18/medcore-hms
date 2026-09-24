import { IsEmail, IsOptional, IsPhoneNumber, IsString, MaxLength, MinLength } from "class-validator";

/** `POST /hospitals/:id/admins` (Super Admin): the same fields as
 * `CreateStaffDto`, with the role fixed to HOSPITAL_ADMIN and no department. */
export class CreateHospitalAdminDto {
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

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  employeeCode!: string;
}
