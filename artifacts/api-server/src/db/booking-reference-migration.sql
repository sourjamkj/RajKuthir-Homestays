-- Raj Kuthir booking references.
--
-- Adds the column and its unique index. Existing rows are filled in by the
-- application: backfillMissingReferences() runs the first time the owner opens
-- the ledger after deploying, so there is nothing to do here for them.
--
-- Safe to run more than once.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS reference text;

-- Unique, but nullable: Postgres allows many NULLs in a unique index, which is
-- what lets the backfill happen gradually instead of needing a value up front.
CREATE UNIQUE INDEX IF NOT EXISTS booking_reference_uniq
  ON bookings (reference);

-- After deploying and opening the ledger once, this should return 0 rows:
--   SELECT count(*) FROM bookings WHERE reference IS NULL;
--
-- And this shows what each guest should be sent:
--   SELECT reference, guest_name, check_in, check_out FROM bookings ORDER BY check_in DESC;
