-- Make audit_log append-only at the database level, so not even a bug in
-- app code (or a stolen app credential) can rewrite history.
-- Rows may only disappear through the cascade when their organization is deleted.
CREATE OR REPLACE FUNCTION audit_log_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_log is append-only: updates are not allowed';
  END IF;
  IF EXISTS (SELECT 1 FROM "organization" WHERE id = OLD.org_id) THEN
    RAISE EXCEPTION 'audit_log is append-only: deletes are not allowed';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_protect
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_protect();
