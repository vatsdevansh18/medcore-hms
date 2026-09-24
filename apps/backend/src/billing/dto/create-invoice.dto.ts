import { IsUUID } from "class-validator";

/** `POST /invoices`: opens (or returns) the appointment's DRAFT invoice.
 * Charges normally arrive automatically (FR-BILL-001); this lets front-desk
 * staff start one before any has been incurred, e.g. to add a manual line. */
export class CreateInvoiceDto {
  @IsUUID()
  appointmentId!: string;
}
