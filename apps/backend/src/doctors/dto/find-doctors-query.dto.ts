import { IsOptional, IsString } from "class-validator";
import { PaginationQueryDto } from "../../common/pagination/pagination-query.dto";

export class FindDoctorsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  specialization?: string;
}
