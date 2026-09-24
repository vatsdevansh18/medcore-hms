import { IsIn, IsOptional, IsUUID } from "class-validator";
import { LabOrderItemStatus, LabOrderPriority } from "@medcore/types";
import { PaginationQueryDto } from "../../common/pagination/pagination-query.dto";
import { CommaSeparatedEnum } from "../../common/validation/comma-separated-enum.decorator";

/** `GET /lab-orders?status=ORDERED,SAMPLE_COLLECTED&priority=URGENT`.
 * `status` matches orders with at least one item in one of the statuses.
 * `medicalRecordId` narrows to one encounter, within the caller's scope
 * (Phase 13B, D-041). */
export class FindLabOrdersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @CommaSeparatedEnum(Object.values(LabOrderItemStatus))
  status?: LabOrderItemStatus[];

  @IsOptional()
  @IsIn(Object.values(LabOrderPriority))
  priority?: LabOrderPriority;

  @IsOptional()
  @IsUUID()
  medicalRecordId?: string;
}
