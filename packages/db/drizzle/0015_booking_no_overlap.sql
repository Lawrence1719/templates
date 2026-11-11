-- No double booking, guaranteed by the database: two active bookings for the
-- same resource can never overlap (including each booking's buffer time),
-- however many requests arrive at once. App code checks first for a friendly
-- message; this constraint is what makes it impossible.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_no_overlap"
  EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(starts_at, blocked_until, '[)') WITH &&
  ) WHERE (status IN ('pending', 'confirmed'));
