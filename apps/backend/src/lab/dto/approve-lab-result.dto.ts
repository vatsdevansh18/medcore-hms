import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { LabResultDecision } from "@medcore/types";

/** `PATCH /lab-orders/:id/items/:itemId/approve` — FR-LAB-004. */
export class ApproveLabResultDto {
  @IsEnum(LabResultDecision)
  decision!: LabResultDecision;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
