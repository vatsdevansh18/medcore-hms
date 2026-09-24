import { IsOptional } from "class-validator";
import { PrescriptionStatus } from "@medcore/types";
import { PaginationQueryDto } from "../../common/pagination/pagination-query.dto";
import { CommaSeparatedEnum } from "../../common/validation/comma-separated-enum.decorator";

/** `GET /prescriptions?status=ISSUED,PARTIALLY_DISPENSED`. */
export class FindPrescriptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @CommaSeparatedEnum(Object.values(PrescriptionStatus))
  status?: PrescriptionStatus[];
}
