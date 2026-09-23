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
}
