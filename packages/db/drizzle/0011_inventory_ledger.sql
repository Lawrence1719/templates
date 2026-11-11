-- The stock ledger is append-only: a wrong movement is fixed with a new one
-- (a count or a correction), never by editing history. Enforced here so app
-- bugs or a stolen credential can't quietly change past stock records.
-- Rows may still go through the cascade when their organization is deleted.

ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_not_negative" CHECK (quantity_milli >= 0);
--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_values_check"
  CHECK (quantity_milli <> 0 OR kind = 'count') ;
--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_balance_check" CHECK (balance_after_milli >= 0);
--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_values_check"
  CHECK (cost_cents >= 0 AND price_cents >= 0 AND reorder_point_milli >= 0 AND reorder_qty_milli >= 0);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION stock_movement_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'stock_movement is append-only: record a correction instead';
  END IF;
  IF EXISTS (SELECT 1 FROM "organization" WHERE id = OLD.org_id) THEN
    RAISE EXCEPTION 'stock_movement is append-only: deletes are not allowed';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER stock_movement_protect
  BEFORE UPDATE OR DELETE ON "stock_movement"
  FOR EACH ROW EXECUTE FUNCTION stock_movement_protect();
