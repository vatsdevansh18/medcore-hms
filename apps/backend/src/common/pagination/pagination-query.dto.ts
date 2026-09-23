import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

/** NFR-PERF-003: every list endpoint is paginated by default, capped at 100 regardless of what's requested. */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}
