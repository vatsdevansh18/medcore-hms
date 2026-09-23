import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, ValidateNested } from "class-validator";
import { LabResultValueDto } from "./lab-result-value.dto";
import { ReportFileMetaDto } from "./report-file-meta.dto";

/** `PATCH /lab-orders/:id/items/:itemId/result` — FR-LAB-003.
 *
 * `values` is deliberately restricted to exactly one entry: a
 * `LabTestReferenceRange` row is keyed only by `labTestId` (gender/age band),
 * not by a per-parameter key within a multi-analyte panel, so this schema
 * can only range-check a single-parameter test correctly — which matches
 * every seeded `LabTest` (Haemoglobin, FBS, Cholesterol, TSH, Platelet
 * Count). A true multi-analyte panel would need a `parameter` column added
 * to `LabTestReferenceRange` first (docs/11-DECISIONS.md) rather than
 * silently mis-applying one range to several differently-named values.
 */
export class EnterLabResultDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1)
  @ValidateNested({ each: true })
  @Type(() => LabResultValueDto)
  values!: LabResultValueDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ReportFileMetaDto)
  reportFile?: ReportFileMetaDto;
}
