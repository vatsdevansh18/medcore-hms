import { IsIn } from "class-validator";
import { LabOrderItemStatus } from "@medcore/types";

/** `PATCH /lab-orders/:id/items/:itemId/status` — FR-LAB-002. Only the two
 * collection/processing transitions go through this endpoint;
 * `RESULT_UPLOADED` is set by `/result` and `APPROVED`/`REJECTED` by
 * `/approve`, never accepted here directly. */
const ALLOWED_STATUS_VALUES = [LabOrderItemStatus.SAMPLE_COLLECTED, LabOrderItemStatus.IN_PROGRESS] as const;

export class UpdateLabOrderItemStatusDto {
  @IsIn(ALLOWED_STATUS_VALUES)
  status!: (typeof ALLOWED_STATUS_VALUES)[number];
}
