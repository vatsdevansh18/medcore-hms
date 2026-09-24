-- Phase 10 — Billing & Payments (docs/11-DECISIONS.md D-027, D-028).

-- DropIndex: an appointment may now have a supplementary invoice for charges
-- incurred after its first invoice was finalized (D-027). "At most one DRAFT
-- invoice per appointment" is enforced by the service layer under an
-- Appointment row lock, not by an index.
DROP INDEX "Invoice_appointmentId_key";

-- CreateIndex
CREATE INDEX "Invoice_appointmentId_idx" ON "Invoice"("appointmentId");

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "finalizedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "recordedBy" TEXT;

-- ─────────────────────────────────────────────────────────────────────────
-- FR-BILL-003: invoice arithmetic is re-verified by the database itself, not
-- only by the application (D-028). Prisma doesn't model CHECK constraints or
-- triggers, so they live here as raw SQL, the same way the appointment
-- EXCLUDE constraints do in the init migration.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "InvoiceItem"
  ADD CONSTRAINT "InvoiceItem_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "InvoiceItem_lineTotal_matches" CHECK ("lineTotal" = "quantity" * "unitPrice");

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_total_matches" CHECK ("total" = "subtotal" + "tax" - "discount"),
  ADD CONSTRAINT "Invoice_amounts_nonnegative" CHECK ("total" >= 0 AND "tax" >= 0 AND "discount" >= 0);

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);

-- Invoice.subtotal must equal the sum of its line items. Deferred to commit
-- so a transaction can insert an item and then update the invoice's totals
-- without tripping the check in between.
CREATE OR REPLACE FUNCTION medcore_verify_invoice_subtotal() RETURNS trigger AS $$
DECLARE
  inv_id TEXT;
  stored NUMERIC;
  computed NUMERIC;
BEGIN
  IF TG_TABLE_NAME = 'Invoice' THEN
    inv_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    inv_id := OLD."invoiceId";
  ELSE
    inv_id := NEW."invoiceId";
  END IF;

  SELECT "subtotal" INTO stored FROM "Invoice" WHERE "id" = inv_id;
  IF NOT FOUND THEN
    -- The invoice itself was deleted in the same transaction.
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM("lineTotal"), 0) INTO computed FROM "InvoiceItem" WHERE "invoiceId" = inv_id;
  IF stored <> computed THEN
    RAISE EXCEPTION 'Invoice % subtotal (%) does not equal the sum of its line items (%)', inv_id, stored, computed
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "InvoiceItem_verify_invoice_subtotal"
  AFTER INSERT OR UPDATE OR DELETE ON "InvoiceItem"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION medcore_verify_invoice_subtotal();

CREATE CONSTRAINT TRIGGER "Invoice_verify_subtotal"
  AFTER INSERT OR UPDATE ON "Invoice"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION medcore_verify_invoice_subtotal();

-- FR-BILL-002: line items of a non-DRAFT invoice are immutable. The only
-- write allowed once an invoice is finalized is appending a credit (negative)
-- line while it still has a balance to correct (FINALIZED/PARTIALLY_PAID).
CREATE OR REPLACE FUNCTION medcore_guard_invoice_item() RETURNS trigger AS $$
DECLARE
  inv_id TEXT;
  inv_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    inv_id := OLD."invoiceId";
  ELSE
    inv_id := NEW."invoiceId";
  END IF;

  SELECT "status"::TEXT INTO inv_status FROM "Invoice" WHERE "id" = inv_id;

  IF inv_status = 'DRAFT' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND inv_status IN ('FINALIZED', 'PARTIALLY_PAID') AND NEW."lineTotal" < 0 THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Line items of % invoice % are immutable (only credit lines may be appended)', inv_status, inv_id
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InvoiceItem_guard_immutable"
  BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceItem"
  FOR EACH ROW EXECUTE FUNCTION medcore_guard_invoice_item();
