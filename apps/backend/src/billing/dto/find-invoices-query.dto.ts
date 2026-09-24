import { IsOptional, IsUUID } from "class-validator";
import { InvoiceStatus } from "@medcore/types";
import { PaginationQueryDto } from "../../common/pagination/pagination-query.dto";
import { CommaSeparatedEnum } from "../../common/validation/comma-separated-enum.decorator";

/** `GET /invoices`: staff work queues ("pending draft invoices",
 * "outstanding invoices", docs/04-UI-UX.md §4). Extends PaginationQueryDto
 * rather than binding filters as separate `@Query()`s (CLAUDE.md). */
export class FindInvoicesQueryDto extends PaginationQueryDto {
  /** One or more statuses, comma-separated (Phase 13: "outstanding" is
   * `FINALIZED,PARTIALLY_PAID`). */
  @IsOptional()
  @CommaSeparatedEnum(Object.values(InvoiceStatus))
  status?: InvoiceStatus[];

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  appointmentId?: string;
}
