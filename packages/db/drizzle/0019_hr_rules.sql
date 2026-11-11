-- HR rules the database guarantees, whatever the app does:
-- a person's clocked time never overlaps, their pending and approved leave
-- never overlaps, decided leave can only move from approved to cancelled,
-- and leave adjustments are append-only.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "hr_settings" ADD CONSTRAINT "hr_settings_values_check"
  CHECK (leave_year_start_month BETWEEN 1 AND 12 AND weekly_hours BETWEEN 1 AND 168
    AND cardinality(work_days) BETWEEN 1 AND 7 AND work_days <@ ARRAY[1,2,3,4,5,6,7]);
--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_values_check"
  CHECK ((end_date IS NULL OR end_date >= start_date)
    AND (manager_id IS NULL OR manager_id <> id)
    AND (pay_rate_cents IS NULL OR pay_rate_cents >= 0));
--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_order_check"
  CHECK (clock_out IS NULL OR clock_out > clock_in);
--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_no_overlap"
  EXCLUDE USING gist (
    employee_id WITH =,
    tstzrange(clock_in, coalesce(clock_out, 'infinity'::timestamptz), '[)') WITH &&
  );
--> statement-breakpoint
ALTER TABLE "leave_type" ADD CONSTRAINT "leave_type_allowance_check"
  CHECK (allowance_half_days IS NULL OR allowance_half_days BETWEEN 0 AND 730);
--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_values_check"
  CHECK (end_day >= start_day AND half_days > 0 AND (NOT half_day OR (start_day = end_day AND half_days = 1)));
--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_no_overlap"
  EXCLUDE USING gist (
    employee_id WITH =,
    daterange(start_day, end_day, '[]') WITH &&
  ) WHERE (status IN ('pending', 'approved'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION leave_request_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'pending' AND EXISTS (SELECT 1 FROM "organization" WHERE id = OLD.org_id)
       AND EXISTS (SELECT 1 FROM "employee" WHERE id = OLD.employee_id) THEN
      RAISE EXCEPTION 'decided leave can''t be deleted: cancel it instead';
    END IF;
    RETURN OLD;
  END IF;
  -- A deleted user's links may be cleared; nothing else changes on its own.
  IF (to_jsonb(NEW) - 'decided_by' - 'created_by' - 'updated_at')
     = (to_jsonb(OLD) - 'decided_by' - 'created_by' - 'updated_at') THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('rejected', 'cancelled') THEN
    RAISE EXCEPTION 'this leave request is % and final', OLD.status;
  END IF;
  IF OLD.status = 'approved' AND (NEW.status <> 'cancelled'
    OR NEW.start_day <> OLD.start_day OR NEW.end_day <> OLD.end_day
    OR NEW.half_days <> OLD.half_days OR NEW.leave_type_id <> OLD.leave_type_id
    OR NEW.employee_id <> OLD.employee_id) THEN
    RAISE EXCEPTION 'approved leave can only be cancelled';
  END IF;
  IF NEW.employee_id <> OLD.employee_id OR NEW.org_id <> OLD.org_id THEN
    RAISE EXCEPTION 'leave can''t move to someone else';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER leave_request_protect BEFORE UPDATE OR DELETE ON "leave_request"
  FOR EACH ROW EXECUTE FUNCTION leave_request_protect();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION leave_adjustment_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'created_by') = (to_jsonb(OLD) - 'created_by') AND NEW.created_by IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'leave adjustments are append-only: add a correcting one';
  END IF;
  IF EXISTS (SELECT 1 FROM "organization" WHERE id = OLD.org_id)
     AND EXISTS (SELECT 1 FROM "employee" WHERE id = OLD.employee_id)
     AND EXISTS (SELECT 1 FROM "leave_type" WHERE id = OLD.leave_type_id) THEN
    RAISE EXCEPTION 'leave adjustments are append-only: add a correcting one';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER leave_adjustment_protect BEFORE UPDATE OR DELETE ON "leave_adjustment"
  FOR EACH ROW EXECUTE FUNCTION leave_adjustment_protect();
