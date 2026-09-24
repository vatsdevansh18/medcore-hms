import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { SearchScope } from "@medcore/types";
import { PaginationQueryDto } from "../../common/pagination/pagination-query.dto";

/** `GET /search?q=&scope=&page=&limit=` (FR-SEARCH-001). Without `scope`
 * the response groups the top hits of every scope the caller may search. */
export class SearchQueryDto extends PaginationQueryDto {
  @IsString()
  @MaxLength(100)
  q!: string;

  @IsOptional()
  @IsIn(Object.values(SearchScope))
  scope?: SearchScope;
}
