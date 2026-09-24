import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  Max,
  Min,
  IsPhoneNumber,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { IsIanaTimezone } from "../../common/validation/is-iana-timezone.decorator";

/** PATCH /hospitals/:id — added in Phase 4 beyond the original endpoint table
 * to cover the "View/update own hospital settings" RBAC row (docs/07-RBAC-MATRIX.md §3.1). */
export class UpdateHospitalDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsPhoneNumber()
  contactPhone?: string;

  @IsOptional()
  @IsIanaTimezone()
  timezone?: string;

  /** FR-PORTAL-002 reschedule policy (docs/11-DECISIONS.md D-035). */
  @IsOptional()
  @IsBoolean()
  patientRescheduleAllowed?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  patientRescheduleCutoffHours?: number;
}
