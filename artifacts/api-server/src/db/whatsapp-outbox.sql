-- The WhatsApp outbox, as lib/db/src/schema/messages.ts defines it.
--
-- WHY THIS FILE EXISTS
--
-- The whole outbound engine already exists in the repository — the Cloud API
-- transport, the four templates, the scheduler with its quiet hours, the
-- retry and opt-out rules and the admin approve/cancel screens — and none of
-- it has ever run, because `whatsapp_messages` was never created in
-- production. Turning WHATSAPP_ENABLED on without this file would put the
-- 15-minute cron into a loop of failing queries against a table that is not
-- there. That is the same drift that cost the guest tables four production
-- 500s in one day; this time the migration comes first.
--
-- Transcribed column by column from the Drizzle schema, not from memory. If
-- the two ever disagree, the schema is right and this file is wrong: it is
-- the schema the code actually queries.
--
-- SAFE TO RUN ON THE LIVE DATABASE. Every statement is guarded — the enums
-- by an explicit pg_type check (CREATE TYPE has no IF NOT EXISTS) and the
-- table and indexes by IF NOT EXISTS. Nothing is dropped, altered or
-- backfilled, and re-running it is a no-op.
--
-- Run with:  railway connect Postgres   then  \i whatsapp-outbox.sql
-- (Railway's Data tab appends LIMIT to whatever you paste, which turns DDL
--  into a syntax error. Use the psql session, not the web query box.)

-- ==================================================================== ENUMS

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

-- ======================================================== WHATSAPP_MESSAGES
-- A queue, not a log of sends that happened elsewhere. Nothing sends inline
-- from a request handler: a row is written here first and the cron drains it,
-- which is what makes the retries, the hold-for-approval and the audit trail
-- possible at all.
--
-- booking_id carries no foreign key, exactly as the schema declares it —
-- `uuid("booking_id")` with no .references(). It is nullable because a
-- message need not be about a stay.

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

-- One message of each kind per booking, ever. This is the whole anti-duplicate
-- story: the scheduler re-queues on every run and this index drops what is
-- already there, so the cron can run as often as it likes.
--
-- Worth knowing what it does NOT cover: Postgres treats NULLs as distinct, so
-- rows with a null booking_id are not constrained by it. Nothing queues those
-- today — scheduleForBooking always has a booking — but a future caller that
-- does would not get idempotency from here.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_booking_kind_uniq
  ON whatsapp_messages (booking_id, kind);

-- The drain query: everything due, by status and time.
CREATE INDEX IF NOT EXISTS whatsapp_due_idx
  ON whatsapp_messages (status, send_after);
