import { pool } from "@workspace/db";

import { logger } from "./logger";

/**
 * Creates the tables Google review requests and replies need, at boot.
 *
 * Additive and idempotent — every statement is IF NOT EXISTS or guarded — so
 * running on every start is a no-op once applied. Not awaited and never
 * thrown: a failure is a log line and the reviews screen says so.
 *
 * The text is a copy of src/db/reviews.sql; review-migrate.test.ts fails if
 * the two ever differ.
 */
export const REVIEWS_MIGRATION_SQL = `-- Google review requests and replies.
--
-- 1. The WhatsApp outbox (whatsapp_messages), exactly as whatsapp-outbox.sql
--    defines it. Review requests are queued there, and that file was written
--    to be run by hand, so it may never have reached production. Re-running
--    it where it already exists is a no-op.
-- 2. google_reviews: reviews of the listing and the owner's replies.
-- 3. booking_issues: "issue during stay" flags. A new table, so no existing
--    query on bookings can be affected by it.
--
-- Additive only: nothing is altered or dropped. Applied at boot by
-- reviews-migrate.ts; review-migrate.test.ts keeps the two copies identical.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_kind') THEN
    CREATE TYPE message_kind AS ENUM (
      'booking_confirmed',
      'checkin_reminder',
      'checkout_today',
      'review_request'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_status') THEN
    CREATE TYPE message_status AS ENUM (
      'draft',
      'pending',
      'sent',
      'failed',
      'cancelled'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id           uuid,
  kind                 message_kind NOT NULL,
  status               message_status NOT NULL DEFAULT 'pending',
  to_phone             text NOT NULL,
  template_name        text NOT NULL,
  template_params      jsonb NOT NULL,
  preview              text NOT NULL,
  send_after           timestamptz NOT NULL DEFAULT now(),
  attempts             integer NOT NULL DEFAULT 0,
  error                text,
  provider_message_id  text,
  sent_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_booking_kind_uniq
  ON whatsapp_messages (booking_id, kind);

CREATE INDEX IF NOT EXISTS whatsapp_due_idx
  ON whatsapp_messages (status, send_after);

CREATE TABLE IF NOT EXISTS google_reviews (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id          text NOT NULL,
  source             text NOT NULL DEFAULT 'manual',
  reviewer_name      text,
  rating             integer NOT NULL,
  text               text,
  created_at         timestamptz NOT NULL,
  reply_text         text,
  reply_status       text NOT NULL DEFAULT 'none',
  reply_note         text,
  matched_booking_id uuid,
  drafted_at         timestamptz,
  approved_at        timestamptz,
  posted_at          timestamptz,
  owner_alerted_at   timestamptz,
  inserted_at        timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS google_review_id_uniq     ON google_reviews (review_id);
CREATE INDEX        IF NOT EXISTS google_review_created_idx ON google_reviews (created_at);

CREATE TABLE IF NOT EXISTS booking_issues (
  booking_id  uuid PRIMARY KEY,
  note        text,
  flagged_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
`;

let applied: Promise<boolean> | null = null;

/** Resolves true once the tables exist. Retries on the next call after a failure. */
export function ensureReviewTables(): Promise<boolean> {
  if (!applied) {
    applied = pool
      .query(REVIEWS_MIGRATION_SQL)
      .then(() => {
        logger.info("Review tables are in place");
        return true;
      })
      .catch((error) => {
        logger.error({ err: error }, "Could not apply the reviews migration");
        applied = null;
        return false;
      });
  }
  return applied;
}
