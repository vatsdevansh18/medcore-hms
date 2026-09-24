import { IsOptional, IsString, MaxLength } from "class-validator";
import { PaginationQueryDto } from "../../common/pagination/pagination-query.dto";

/** `GET /lab-tests?search=` — the hospital's test catalog (Phase 13B, D-041). */
export class FindLabTestsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
