import { IsDateString, IsIn, IsOptional } from "class-validator";
import { AppointmentStatus } from "@medcore/types";
import { PaginationQueryDto } from "../../common/pagination/pagination-query.dto";

export class FindAppointmentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(Object.values(AppointmentStatus))
  status?: AppointmentStatus;

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
}
