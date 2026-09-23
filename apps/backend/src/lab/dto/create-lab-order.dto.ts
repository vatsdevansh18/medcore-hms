import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsUUID, ValidateNested } from "class-validator";
import { LabOrderPriority } from "@medcore/types";
import { CreateLabOrderItemDto } from "./create-lab-order-item.dto";

/** `POST /lab-orders` — FR-LAB-001. "Own encounter" only, same pattern as
 * `POST /prescriptions`/`POST /medical-records`: the caller must be the
 * medical record's own doctor. */
export class CreateLabOrderDto {
  @IsUUID()
  medicalRecordId!: string;

  @IsOptional()
  @IsEnum(LabOrderPriority)
  priority?: LabOrderPriority;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreateLabOrderItemDto)
  items!: CreateLabOrderItemDto[];
}
