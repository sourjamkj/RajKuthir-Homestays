-- What a guest was quoted, when it reached them, and whether the advance
-- arrived. The 24-hour hold is NOT stored: it is derived from quote_sent_at
-- and advance_paid_at, so it cannot be left behind by a job that failed to
-- run. Money in paise, matching the ledger. Safe to re-run.
ALTER TABLE enquiries
  ADD COLUMN IF NOT EXISTS quoted_total_paise   integer,
  ADD COLUMN IF NOT EXISTS quoted_advance_paise integer,
  ADD COLUMN IF NOT EXISTS quote_sent_at        timestamptz,
  ADD COLUMN IF NOT EXISTS advance_paid_at      timestamptz;
