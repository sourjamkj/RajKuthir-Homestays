-- Google review requests and replies.
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
