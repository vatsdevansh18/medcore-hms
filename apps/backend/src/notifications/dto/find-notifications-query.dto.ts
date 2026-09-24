import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";
import { PaginationQueryDto } from "../../common/pagination/pagination-query.dto";

/** Extends PaginationQueryDto rather than binding a second `@Query()`
 * (CLAUDE.md: forbidNonWhitelisted validates the whole query against one DTO). */
export class FindNotificationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === "true" ? true : value === "false" ? false : value))
  @IsBoolean()
  unreadOnly?: boolean;
}
