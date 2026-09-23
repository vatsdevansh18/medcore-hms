import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsUUID, ValidateNested } from "class-validator";
import { PrescriptionItemDto } from "./prescription-item.dto";

/** `POST /prescriptions` — FR-RX-001/002. `supersedesId` is only meaningful
 * for a correction (FR-RX-003) — the referenced prescription must belong to
 * the same patient and still be `ISSUED` (service-layer check). */
export class CreatePrescriptionDto {
  @IsUUID()
  medicalRecordId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items!: PrescriptionItemDto[];

  @IsOptional()
  @IsUUID()
  supersedesId?: string;
}
