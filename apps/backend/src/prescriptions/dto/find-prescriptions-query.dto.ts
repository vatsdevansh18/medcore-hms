import { IsEnum, IsOptional } from "class-validator";
import { PrescriptionStatus } from "@medcore/types";
import { PaginationQueryDto } from "../../common/pagination/pagination-query.dto";

/** `GET /prescriptions`: a patient's own prescriptions (FR-PORTAL-001). */
export class FindPrescriptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(PrescriptionStatus)
  status?: PrescriptionStatus;
}
