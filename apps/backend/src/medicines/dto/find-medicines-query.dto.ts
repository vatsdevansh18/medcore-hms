import { IsOptional, IsString } from "class-validator";
import { PaginationQueryDto } from "../../common/pagination/pagination-query.dto";

/** `GET /medicines?search=` — docs/08-API-CONTRACT.md's future FR-PHARM-001
 * row, brought forward for Phase 7's prescription-creation search
 * (docs/05-DEVELOPMENT-PLAN.md Phase 7's "medicine search against
 * inventory"). Catalog/batch *management* remains Phase 9 scope. */
export class FindMedicinesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;
}
