-- Orders are a business record. Once fulfilled or cancelled an order is
-- final: its lines, totals and customer can't change, it can't be reopened
-- or deleted, and its timeline is append-only. Enforced here so app bugs or a
-- stolen credential can't rewrite what was sold.
-- Rows may still go through the cascade when their organization is deleted.

ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_amounts_check"
  CHECK (subtotal_cents >= 0 AND tax_cents >= 0 AND total_cents >= 0);
--> statement-breakpoint
ALTER TABLE "sales_order_line" ADD CONSTRAINT "sales_order_line_values_check"
  CHECK (quantity_milli > 0 AND tax_rate_bp BETWEEN 0 AND 10000);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sales_order_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' AND EXISTS (SELECT 1 FROM "organization" WHERE id = OLD.org_id) THEN
      RAISE EXCEPTION 'order % is no longer a draft: cancel it instead of deleting', OLD.number;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('fulfilled', 'cancelled') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.number IS DISTINCT FROM OLD.number
      OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.subtotal_cents IS DISTINCT FROM OLD.subtotal_cents
      OR NEW.tax_cents IS DISTINCT FROM OLD.tax_cents
      OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
      OR NEW.location_id IS DISTINCT FROM OLD.location_id
      OR NEW.order_date IS DISTINCT FROM OLD.order_date THEN
      RAISE EXCEPTION 'order % is %: it can''t change', OLD.number, OLD.status;
    END IF;
  END IF;
  IF NEW.number IS DISTINCT FROM OLD.number THEN
    RAISE EXCEPTION 'order numbers can''t change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER sales_order_protect
  BEFORE UPDATE OR DELETE ON "sales_order"
  FOR EACH ROW EXECUTE FUNCTION sales_order_protect();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sales_order_line_protect() RETURNS trigger AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status FROM "sales_order"
    WHERE id = COALESCE(NEW.order_id, OLD.order_id);
  IF parent_status IN ('fulfilled', 'cancelled') THEN
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "organization" WHERE id = OLD.org_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'order lines are locked once the order is %', parent_status;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER sales_order_line_protect
  BEFORE INSERT OR UPDATE OR DELETE ON "sales_order_line"
  FOR EACH ROW EXECUTE FUNCTION sales_order_line_protect();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sales_order_event_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'order history is append-only';
  END IF;
  -- Drafts can be deleted along with their history; anything else keeps it.
  IF EXISTS (SELECT 1 FROM "organization" WHERE id = OLD.org_id)
     AND EXISTS (SELECT 1 FROM "sales_order" WHERE id = OLD.order_id AND status <> 'draft') THEN
    RAISE EXCEPTION 'order history is append-only';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER sales_order_event_protect
  BEFORE UPDATE OR DELETE ON "sales_order_event"
  FOR EACH ROW EXECUTE FUNCTION sales_order_event_protect();
