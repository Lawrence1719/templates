-- Membership records the database protects: what was paid (periods), the
-- visit log (check-ins can be voided once, never edited or deleted) and the
-- history are append-only, and a cancelled membership is final.
-- Rows may still go through the cascade when their organization is deleted,
-- and a deleted user's links may be cleared (ON DELETE SET NULL).

ALTER TABLE "membership_settings" ADD CONSTRAINT "membership_settings_values_check"
  CHECK (check_in_cooldown_minutes BETWEEN 0 AND 1440 AND reminder_days BETWEEN 0 AND 90);
--> statement-breakpoint
ALTER TABLE "membership_plan" ADD CONSTRAINT "membership_plan_values_check"
  CHECK (price_cents >= 0 AND period_count BETWEEN 1 AND 1000 AND (visit_limit IS NULL OR visit_limit > 0));
--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_values_check"
  CHECK (period_end >= period_start AND period_start >= started_on AND length(card_token) >= 20
    AND (status <> 'paused' OR paused_on IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "membership_period" ADD CONSTRAINT "membership_period_values_check"
  CHECK (end_day >= start_day AND price_cents >= 0 AND (paid_via <> 'invoice' OR invoice_id IS NOT NULL));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION membership_parent_alive(org uuid, mid uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM "organization" WHERE id = org)
     AND EXISTS (SELECT 1 FROM "membership" WHERE id = mid);
$$ LANGUAGE sql STABLE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION membership_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'created_by') = (to_jsonb(OLD) - 'created_by') AND NEW.created_by IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
  END IF;
  IF membership_parent_alive(OLD.org_id, OLD.membership_id) THEN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER membership_period_append_only BEFORE UPDATE OR DELETE ON "membership_period"
  FOR EACH ROW EXECUTE FUNCTION membership_append_only();
--> statement-breakpoint
CREATE TRIGGER membership_event_append_only BEFORE UPDATE OR DELETE ON "membership_event"
  FOR EACH ROW EXECUTE FUNCTION membership_append_only();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION membership_check_in_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF membership_parent_alive(OLD.org_id, OLD.membership_id) THEN
      RAISE EXCEPTION 'check-ins can''t be deleted: void it instead';
    END IF;
    RETURN OLD;
  END IF;
  -- Clearing a deleted user's link.
  IF (to_jsonb(NEW) - 'checked_in_by' - 'voided_by') = (to_jsonb(OLD) - 'checked_in_by' - 'voided_by')
     AND (NEW.checked_in_by IS NULL OR NEW.checked_in_by = OLD.checked_in_by)
     AND (NEW.voided_by IS NULL OR NEW.voided_by = OLD.voided_by) THEN
    RETURN NEW;
  END IF;
  -- Voiding, once.
  IF OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL
     AND (to_jsonb(NEW) - 'voided_at' - 'voided_by') = (to_jsonb(OLD) - 'voided_at' - 'voided_by') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'check-ins can only be voided, once';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER membership_check_in_protect BEFORE UPDATE OR DELETE ON "membership_check_in"
  FOR EACH ROW EXECUTE FUNCTION membership_check_in_protect();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION membership_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "organization" WHERE id = OLD.org_id) THEN
      RAISE EXCEPTION 'memberships can''t be deleted: cancel it instead';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'cancelled'
     AND (to_jsonb(NEW) - 'created_by' - 'updated_at') <> (to_jsonb(OLD) - 'created_by' - 'updated_at') THEN
    RAISE EXCEPTION 'this membership is cancelled and final';
  END IF;
  IF NEW.customer_id <> OLD.customer_id OR NEW.org_id <> OLD.org_id OR NEW.started_on <> OLD.started_on THEN
    RAISE EXCEPTION 'a membership can''t move to someone else';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER membership_protect BEFORE UPDATE OR DELETE ON "membership"
  FOR EACH ROW EXECUTE FUNCTION membership_protect();
