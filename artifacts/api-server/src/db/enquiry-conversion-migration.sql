-- Links an enquiry to the booking it became.
--
-- Without this column, converting an enquiry twice would create the same stay
-- in the calendar under two references, and the guest would be sent whichever
-- one the owner happened to be looking at. It is the whole idempotency
-- mechanism for POST /api/enquiries/:id/convert.
--
-- Additive and nullable: nothing existing is touched, no booking row is read
-- or written, and every enquiry already in the table is simply unconverted,
-- which is true.
--
-- ON DELETE SET NULL, not CASCADE — deleting a booking must not delete the
-- enquiry that produced it. That enquiry is still a real lead and still part
-- of the demand signal behind range-based peak pricing.
--
-- Safe to run more than once. Run it BEFORE deploying the conversion feature.

ALTER TABLE enquiries
  ADD COLUMN IF NOT EXISTS converted_booking_id uuid;

DO $$ BEGIN
  ALTER TABLE enquiries
    ADD CONSTRAINT enquiries_converted_booking_fk
    FOREIGN KEY (converted_booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- Finding the enquiry behind a booking, and listing what is still unconverted.
CREATE INDEX IF NOT EXISTS enquiry_converted_booking_idx
  ON enquiries (converted_booking_id);

-- ================================================================== CHECKS
--
-- 1. The column is present:
--      SELECT column_name FROM information_schema.columns
--       WHERE table_name = 'enquiries' AND column_name = 'converted_booking_id';
--
-- 2. Nothing is converted yet, which is expected on first run:
--      SELECT count(*) FROM enquiries WHERE converted_booking_id IS NOT NULL;
--
-- 3. Enquiries that are marked converted but have no booking behind them are
--    ones that were converted by hand before this existed. They are not
--    broken, but they will offer the Convert button again — link them by hand
--    if you want that to stop:
--      SELECT id, name, check_in, check_out FROM enquiries
--       WHERE status = 'converted' AND converted_booking_id IS NULL;
