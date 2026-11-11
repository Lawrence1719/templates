-- Point-of-sale records are money records. A sale can't be edited or deleted:
-- only its refunded amounts can grow, up to what was sold. Payments, refunds
-- and cash movements are append-only, and a closed shift is final. Nothing
-- can be added to a closed shift. Enforced here so app bugs or a stolen
-- credential can't rewrite the till.
-- Rows may still go through the cascade when their organization is deleted,
-- and a deleted user's name links may be cleared (ON DELETE SET NULL).

ALTER TABLE "pos_settings" ADD CONSTRAINT "pos_settings_values_check"
  CHECK (tax_rate_bp BETWEEN 0 AND 10000 AND max_discount_bp BETWEEN 0 AND 10000 AND next_number > 0);
--> statement-breakpoint
ALTER TABLE "pos_shift" ADD CONSTRAINT "pos_shift_values_check"
  CHECK (opening_float_cents >= 0 AND (counted_cash_cents IS NULL OR counted_cash_cents >= 0));
--> statement-breakpoint
ALTER TABLE "pos_cash_movement" ADD CONSTRAINT "pos_cash_movement_amount_check"
  CHECK (amount_cents > 0);
--> statement-breakpoint
ALTER TABLE "pos_sale" ADD CONSTRAINT "pos_sale_amounts_check"
  CHECK (subtotal_cents >= 0 AND discount_cents >= 0 AND tax_cents >= 0 AND total_cents >= 0
    AND refunded_cents BETWEEN 0 AND total_cents);
--> statement-breakpoint
ALTER TABLE "pos_sale_line" ADD CONSTRAINT "pos_sale_line_values_check"
  CHECK (quantity_milli > 0 AND unit_price_cents >= 0
    AND discount_bp BETWEEN 0 AND 10000 AND discount_cents >= 0
    AND tax_rate_bp BETWEEN 0 AND 10000 AND tax_cents >= 0 AND total_cents >= 0
    AND refunded_qty_milli BETWEEN 0 AND quantity_milli
    AND refunded_cents BETWEEN 0 AND total_cents);
--> statement-breakpoint
ALTER TABLE "pos_payment" ADD CONSTRAINT "pos_payment_values_check"
  CHECK (amount_cents > 0 AND change_cents >= 0 AND tendered_cents = amount_cents + change_cents
    AND (change_cents = 0 OR tender = 'cash'));
--> statement-breakpoint
ALTER TABLE "pos_refund" ADD CONSTRAINT "pos_refund_amount_check" CHECK (amount_cents >= 0);
--> statement-breakpoint
ALTER TABLE "pos_refund_line" ADD CONSTRAINT "pos_refund_line_values_check"
  CHECK (quantity_milli > 0 AND amount_cents >= 0);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pos_org_alive(org uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM "organization" WHERE id = org);
$$ LANGUAGE sql STABLE;
--> statement-breakpoint
-- Append-only tables: no updates, deletes only when the organization goes.
-- Only clears links to a deleted user (ON DELETE SET NULL), changing nothing else.
CREATE OR REPLACE FUNCTION pos_only_clears_users(n jsonb, o jsonb, cols text[]) RETURNS boolean AS $$
DECLARE
  c text;
BEGIN
  FOREACH c IN ARRAY cols LOOP
    IF n->>c IS NOT NULL AND n->>c IS DISTINCT FROM o->>c THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN (n - cols) = (o - cols);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pos_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND pos_only_clears_users(to_jsonb(NEW), to_jsonb(OLD), ARRAY['created_by']) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' OR pos_org_alive(OLD.org_id) THEN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER pos_payment_append_only BEFORE UPDATE OR DELETE ON "pos_payment"
  FOR EACH ROW EXECUTE FUNCTION pos_append_only();
--> statement-breakpoint
CREATE TRIGGER pos_refund_append_only BEFORE UPDATE OR DELETE ON "pos_refund"
  FOR EACH ROW EXECUTE FUNCTION pos_append_only();
--> statement-breakpoint
CREATE TRIGGER pos_refund_line_append_only BEFORE UPDATE OR DELETE ON "pos_refund_line"
  FOR EACH ROW EXECUTE FUNCTION pos_append_only();
--> statement-breakpoint
CREATE TRIGGER pos_cash_movement_append_only BEFORE UPDATE OR DELETE ON "pos_cash_movement"
  FOR EACH ROW EXECUTE FUNCTION pos_append_only();
--> statement-breakpoint
-- Sales, cash movements and refunds can only be added to an open shift.
CREATE OR REPLACE FUNCTION pos_require_open_shift() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "pos_shift" WHERE id = NEW.shift_id AND status = 'open') THEN
    RAISE EXCEPTION 'shift % is closed', NEW.shift_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER pos_sale_open_shift BEFORE INSERT ON "pos_sale"
  FOR EACH ROW EXECUTE FUNCTION pos_require_open_shift();
--> statement-breakpoint
CREATE TRIGGER pos_cash_movement_open_shift BEFORE INSERT ON "pos_cash_movement"
  FOR EACH ROW EXECUTE FUNCTION pos_require_open_shift();
--> statement-breakpoint
CREATE TRIGGER pos_refund_open_shift BEFORE INSERT ON "pos_refund"
  FOR EACH ROW EXECUTE FUNCTION pos_require_open_shift();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pos_sale_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pos_org_alive(OLD.org_id) THEN
      RAISE EXCEPTION 'sale % can''t be deleted: refund it instead', OLD.number;
    END IF;
    RETURN OLD;
  END IF;
  IF NOT pos_only_clears_users(to_jsonb(NEW) - 'refunded_cents', to_jsonb(OLD) - 'refunded_cents', ARRAY['cashier_id']) THEN
    RAISE EXCEPTION 'sale % can''t be edited', OLD.number;
  END IF;
  IF NEW.refunded_cents < OLD.refunded_cents THEN
    RAISE EXCEPTION 'refunds can''t be taken back';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER pos_sale_protect BEFORE UPDATE OR DELETE ON "pos_sale"
  FOR EACH ROW EXECUTE FUNCTION pos_sale_protect();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pos_sale_line_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pos_org_alive(OLD.org_id) THEN
      RAISE EXCEPTION 'sale lines can''t be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF (to_jsonb(NEW) - 'refunded_qty_milli' - 'refunded_cents')
     <> (to_jsonb(OLD) - 'refunded_qty_milli' - 'refunded_cents') THEN
    RAISE EXCEPTION 'sale lines can''t be edited';
  END IF;
  IF NEW.refunded_qty_milli < OLD.refunded_qty_milli OR NEW.refunded_cents < OLD.refunded_cents THEN
    RAISE EXCEPTION 'refunds can''t be taken back';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER pos_sale_line_protect BEFORE UPDATE OR DELETE ON "pos_sale_line"
  FOR EACH ROW EXECUTE FUNCTION pos_sale_line_protect();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pos_shift_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pos_org_alive(OLD.org_id) THEN
      RAISE EXCEPTION 'shifts can''t be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF pos_only_clears_users(to_jsonb(NEW), to_jsonb(OLD), ARRAY['opened_by', 'closed_by']) THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'this shift is closed';
  END IF;
  IF NEW.register_id IS DISTINCT FROM OLD.register_id
    OR NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.opening_float_cents IS DISTINCT FROM OLD.opening_float_cents
    OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
    OR NEW.opened_by IS DISTINCT FROM OLD.opened_by THEN
    RAISE EXCEPTION 'a shift''s opening can''t change';
  END IF;
  IF NEW.status = 'closed' AND (NEW.counted_cash_cents IS NULL OR NEW.expected_cash_cents IS NULL
    OR NEW.variance_cents IS DISTINCT FROM NEW.counted_cash_cents - NEW.expected_cash_cents) THEN
    RAISE EXCEPTION 'closing a shift needs the cash count';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER pos_shift_protect BEFORE UPDATE OR DELETE ON "pos_shift"
  FOR EACH ROW EXECUTE FUNCTION pos_shift_protect();
