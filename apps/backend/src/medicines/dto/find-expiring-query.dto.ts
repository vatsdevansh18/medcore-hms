import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { PaginationQueryDto } from "../../common/pagination/pagination-query.dto";

/** `GET /medicines/expiring?days=` — the Pharmacist's "expiring soon" view,
 * the same window the nightly digest uses (FR-PHARM-005, default 30 days).
 * Extends PaginationQueryDto rather than binding `days` as a second
 * `@Query()` (CLAUDE.md, forbidNonWhitelisted). */
export class FindExpiringQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days: number = 30;
}
