import { IsOptional, Matches } from "class-validator";
import { PaginationQueryDto } from "../../common/pagination/pagination-query.dto";

/** `GET /audit-logs?entityType=Appointment`. */
export class FindAuditLogsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Matches(/^[A-Z][A-Za-z]{1,40}$/, { message: "entityType must be a model name, e.g. Appointment" })
  entityType?: string;
}
