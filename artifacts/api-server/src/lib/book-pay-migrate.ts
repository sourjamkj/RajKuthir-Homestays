import { pool } from "@workspace/db";

import { logger } from "./logger";

/**
 * Applies the Book & Pay migration at boot, so nobody has to paste SQL into
 * Railway by hand.
 *
 * Safe by construction: the SQL only CREATEs a new enum, two new tables and
 * their indexes, every statement guarded by IF NOT EXISTS / duplicate_object,
 * so running it on every start is a no-op once applied. It never alters or
 * drops anything that already exists.
 *
 * Like runSchemaCheck, it runs after the server is listening, is not awaited,
 * and can never stop the site: a failure is a log line, and the Book & Pay
 * routes keep answering "not switched on yet" until it succeeds.
 *
 * The text is a copy of src/db/book-and-pay.sql; book-pay-rules.test.ts fails
 * if the two ever differ.
 */
export const BOOK_PAY_MIGRATION_SQL = `-- Self-serve "Book & Pay by UPI".
--
-- Two NEW tables and one enum. Nothing existing is altered: enquiries,
-- bookings and calendar_events are untouched, so this cannot break any
-- query that already runs. Safe to run more than once.
--
-- Run it in Railway > Postgres > Data > Query BEFORE using the new booking
-- widget. Until it runs the site keeps working; only the new Book & Pay
-- endpoints answer "not set up yet".

DO $$ BEGIN
  CREATE TYPE payment_request_status AS ENUM
    ('awaiting_payment', 'submitted', 'confirmed', 'rejected', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS payment_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id         uuid NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  token_hash         text NOT NULL,
  reference          text NOT NULL,
  status             payment_request_status NOT NULL DEFAULT 'awaiting_payment',
  total_paise        integer NOT NULL,
  advance_paise      integer NOT NULL,
  advance_percent    integer NOT NULL,
  hold_expires_at    timestamptz NOT NULL,
  utr                text,
  utr_submitted_at   timestamptz,
  screenshot         bytea,
  screenshot_mime    text,
  screenshot_bytes   integer,
  decided_at         timestamptz,
  reject_reason      text,
  expiry_notified_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_request_token_uniq     ON payment_requests (token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS payment_request_reference_uniq ON payment_requests (reference);
-- One UTR, one booking. NULLs (not yet paid) do not collide in Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS payment_request_utr_uniq       ON payment_requests (utr);
CREATE UNIQUE INDEX IF NOT EXISTS payment_request_enquiry_uniq   ON payment_requests (enquiry_id);
CREATE INDEX        IF NOT EXISTS payment_request_status_idx     ON payment_requests (status);

CREATE TABLE IF NOT EXISTS payment_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  kind               text NOT NULL,
  detail             text,
  at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_event_at_idx ON payment_events (at);
`;

export async function ensureBookPayTables(): Promise<void> {
  try {
    await pool.query(BOOK_PAY_MIGRATION_SQL);
    logger.info("Book & Pay tables are in place");
  } catch (error) {
    logger.error({ err: error }, "Could not apply the Book & Pay migration; online booking stays off");
  }
}
