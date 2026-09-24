import { IsOptional, IsUUID } from "class-validator";
import { PrescriptionStatus } from "@medcore/types";
import { PaginationQueryDto } from "../../common/pagination/pagination-query.dto";
import { CommaSeparatedEnum } from "../../common/validation/comma-separated-enum.decorator";

/** `GET /prescriptions?status=ISSUED,PARTIALLY_DISPENSED&medicalRecordId=`.
 * `medicalRecordId` narrows to one encounter, within the caller's scope
 * (Phase 13B, D-041). */
export class FindPrescriptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @CommaSeparatedEnum(Object.values(PrescriptionStatus))
  status?: PrescriptionStatus[];

  @IsOptional()
  @IsUUID()
  medicalRecordId?: string;
}
