import { IsEnum, IsOptional, IsUUID } from "class-validator";
import { InvoiceStatus } from "@medcore/types";
import { PaginationQueryDto } from "../../common/pagination/pagination-query.dto";

/** `GET /invoices`: staff work queues ("pending draft invoices",
 * "outstanding invoices", docs/04-UI-UX.md §4). Extends PaginationQueryDto
 * rather than binding filters as separate `@Query()`s (CLAUDE.md). */
export class FindInvoicesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  appointmentId?: string;
}
