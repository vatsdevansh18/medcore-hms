import {
  IsEmail,
  IsIn,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
import { UserRole } from "@medcore/types";

const PROVISIONABLE_STAFF_ROLES = [
  UserRole.HOSPITAL_ADMIN,
  UserRole.NURSE,
  UserRole.RECEPTIONIST,
  UserRole.LAB_TECHNICIAN,
  UserRole.PHARMACIST,
  UserRole.ACCOUNTANT,
] as const;

/** POST /users — Hospital Admin provisioning non-doctor staff. Doctors go
 * through POST /doctors instead (richer profile); patients through
 * POST /patients or self-registration — see docs/07-RBAC-MATRIX.md §3.2. */
export class CreateStaffDto {
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

  @IsIn(PROVISIONABLE_STAFF_ROLES)
  role!: (typeof PROVISIONABLE_STAFF_ROLES)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  employeeCode!: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
