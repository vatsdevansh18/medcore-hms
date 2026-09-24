import { IsDateString, IsIn, IsOptional, IsUUID } from "class-validator";
import { AppointmentStatus } from "@medcore/types";
import { PaginationQueryDto } from "../../common/pagination/pagination-query.dto";
import { CommaSeparatedEnum } from "../../common/validation/comma-separated-enum.decorator";

export class FindAppointmentsQueryDto extends PaginationQueryDto {
  /** One or more statuses, comma-separated (Phase 13). */
  @IsOptional()
  @CommaSeparatedEnum(Object.values(AppointmentStatus))
  status?: AppointmentStatus[];

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** Order by `scheduledStart` (default `desc`, newest first). The portal
   * lists upcoming visits soonest first (Phase 12). */
  @IsOptional()
  @IsIn(["asc", "desc"])
  sortOrder?: "asc" | "desc";

  /** Front-desk and admin views filter by doctor (Phase 13). Ignored for a
   * doctor or patient, whose own scope always applies. */
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  /** Phase 13B (D-041): one patient's visits (the front-desk patient page).
   * Narrows within the caller's scope, like `doctorId`. */
  @IsOptional()
  @IsUUID()
  patientId?: string;
}
