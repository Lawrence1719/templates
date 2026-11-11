-- Invoices are financial records. Once a quote or invoice leaves draft, its
-- lines, totals, customer, number and dates can't change and it can't be
-- deleted (void it instead). Enforced here so a bug in app code, or a stolen
-- app credential, can't quietly rewrite what a customer was billed.
-- Rows may still disappear through the cascade when their organization is deleted.

ALTER TABLE "invoice" ADD CONSTRAINT "invoice_amounts_check"
  CHECK (subtotal_cents >= 0 AND tax_cents >= 0 AND total_cents >= 0
         AND amount_paid_cents >= 0 AND amount_paid_cents <= total_cents);
--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_values_check"
  CHECK (quantity_milli > 0 AND tax_rate_bp BETWEEN 0 AND 10000);
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_amount_check" CHECK (amount_cents > 0);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION invoice_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' AND EXISTS (SELECT 1 FROM "organization" WHERE id = OLD.org_id) THEN
      RAISE EXCEPTION 'invoice % is final: void it instead of deleting', OLD.number;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (
       NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.number IS DISTINCT FROM OLD.number
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
    OR NEW.due_on IS DISTINCT FROM OLD.due_on
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.subtotal_cents IS DISTINCT FROM OLD.subtotal_cents
    OR NEW.tax_cents IS DISTINCT FROM OLD.tax_cents
    OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
  ) THEN
    RAISE EXCEPTION 'invoice % is final: its contents can''t change', OLD.number;
  END IF;
  IF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'invoice % is final: it can''t go back to draft', OLD.number;
  END IF;
  IF OLD.status = 'void' AND NEW.status <> 'void' THEN
    RAISE EXCEPTION 'invoice % is void', OLD.number;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoice_protect
  BEFORE UPDATE OR DELETE ON "invoice"
  FOR EACH ROW EXECUTE FUNCTION invoice_protect();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION invoice_line_protect() RETURNS trigger AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status FROM "invoice"
    WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "organization" WHERE id = OLD.org_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'invoice lines are locked once the invoice is sent';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoice_line_protect
  BEFORE INSERT OR UPDATE OR DELETE ON "invoice_line"
  FOR EACH ROW EXECUTE FUNCTION invoice_line_protect();
