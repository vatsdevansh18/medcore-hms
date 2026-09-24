import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { UserRole } from "@medcore/types";
import { PaginationQueryDto } from "../../common/pagination/pagination-query.dto";

/** Roles that appear in a hospital's staff directory: everyone who works
 * there, doctors included. Patients and Super Admins never do. */
export const STAFF_DIRECTORY_ROLES = [
  UserRole.HOSPITAL_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.RECEPTIONIST,
  UserRole.LAB_TECHNICIAN,
  UserRole.PHARMACIST,
  UserRole.ACCOUNTANT,
] as const;

/** `GET /users?role=&search=` — the Hospital Admin's staff directory
 * (Phase 13B, D-041). */
export class FindStaffQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(STAFF_DIRECTORY_ROLES)
  role?: (typeof STAFF_DIRECTORY_ROLES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
