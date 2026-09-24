import { IsOptional } from "class-validator";
import { PaymentMethod, PaymentStatus } from "@medcore/types";
import { PaginationQueryDto } from "../../common/pagination/pagination-query.dto";
import { CommaSeparatedEnum } from "../../common/validation/comma-separated-enum.decorator";

/** `GET /payments?status=PENDING,FAILED&method=STRIPE`. */
export class FindPaymentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @CommaSeparatedEnum(Object.values(PaymentStatus))
  status?: PaymentStatus[];

  @IsOptional()
  @CommaSeparatedEnum(Object.values(PaymentMethod))
  method?: PaymentMethod[];
}
