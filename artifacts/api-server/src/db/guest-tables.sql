-- The five guest-verification tables, as lib/db/src/schema/guests.ts defines
-- them. THIS FILE IS THE SINGLE SOURCE OF TRUTH FOR THESE TABLES.
--
-- WHY IT REPLACES THREE EARLIER FILES
--
-- These tables were originally hand-built from DDL that never matched the
-- Drizzle schema, and production paid for it four separate times in one day —
-- every failure the same root cause, each visible only on one kind of
-- operation:
--
--   1. guest_documents had no booking_id or deleted_at    500 on SELECT
--   2. enquiries had no converted_booking_id              500 on SELECT
--   3. guest_onboarding.guest_id was NOT NULL and absent
--      from the schema, so every INSERT omitted it        500 on INSERT
--   4. booking_guests had no id column                    500 on a join
--
-- A missing column announces itself the first time anything reads the table.
-- An extra required one stays silent until something writes. That is why the
-- diagnosis arrived in instalments, and why the three files written along the
-- way — guest-schema-reconcile.sql, guest-onboarding-migration.sql and
-- guest-relax-legacy-columns.sql — have been deleted. Each patched one symptom
-- of the drift; run in order against a fresh database they would faithfully
-- rebuild it. This file replaces all three.
--
-- KEEP IT IN STEP WITH THE SCHEMA
--
-- lib/db/src/schema/guests.ts is the definition; this file is the DDL that
-- matches it. Change one and you must change the other in the same commit.
-- src/lib/schema-check.ts compares the two at boot and logs any disagreement,
-- so the next drift is announced in the deploy log rather than in a 500.
--
-- NOT IDEMPOTENT, AND DESTRUCTIVE BY DESIGN: it drops all five tables first,
-- so it rebuilds them exactly rather than patching whatever is there. Safe
-- when they are empty — which they were when this was first run, at 0 rows.
-- Once real guest documents exist, back them up before running it again.
--
-- The whole thing is one transaction: it either rebuilds every table or
-- changes nothing.

BEGIN;

DROP TABLE IF EXISTS guest_documents CASCADE;
DROP TABLE IF EXISTS booking_guests CASCADE;
DROP TABLE IF EXISTS guest_onboarding CASCADE;
DROP TABLE IF EXISTS guest_management_access CASCADE;
DROP TABLE IF EXISTS guests CASCADE;

DO $$ BEGIN
  CREATE TYPE guest_document_status AS ENUM ('pending','submitted','verified','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE guest_onboarding_status AS ENUM ('pending','submitted','verified','expired','blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE guests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name  text NOT NULL,
  phone      text NOT NULL,
  email      text,
  address    text,
  city       text,
  state      text,
  country    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guest_phone_idx ON guests (phone);

CREATE TABLE booking_guests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  guest_id   uuid NOT NULL REFERENCES guests(id)   ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX booking_guest_pair_uniq ON booking_guests (booking_id, guest_id);
CREATE INDEX booking_guest_booking_idx ON booking_guests (booking_id);
CREATE INDEX booking_guest_guest_idx   ON booking_guests (guest_id);

CREATE TABLE guest_documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id           uuid NOT NULL REFERENCES guests(id)   ON DELETE CASCADE,
  booking_id         uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  document_type      text NOT NULL,
  document_number    text,
  source             text NOT NULL DEFAULT 'upload',
  original_filename  text,
  mime_type          text,
  size_bytes         integer,
  file_data          bytea,
  external_reference text,
  status             guest_document_status NOT NULL DEFAULT 'submitted',
  rejection_reason   text,
  uploaded_at        timestamptz NOT NULL DEFAULT now(),
  verified_at        timestamptz,
  verified_by        text,
  deleted_at         timestamptz
);
CREATE INDEX guest_document_guest_idx   ON guest_documents (guest_id);
CREATE INDEX guest_document_booking_idx ON guest_documents (booking_id);
CREATE INDEX guest_document_status_idx  ON guest_documents (status);

CREATE TABLE guest_onboarding (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  token_hash            text NOT NULL,
  expires_at            timestamptz NOT NULL,
  verification_deadline timestamptz NOT NULL,
  status                guest_onboarding_status NOT NULL DEFAULT 'pending',
  last_sent_at          timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX guest_onboarding_token_uniq   ON guest_onboarding (token_hash);
CREATE UNIQUE INDEX guest_onboarding_booking_uniq ON guest_onboarding (booking_id);
CREATE INDEX guest_onboarding_expiry_idx          ON guest_onboarding (expires_at);

CREATE TABLE guest_management_access (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX guest_management_access_token_uniq   ON guest_management_access (token_hash);
CREATE UNIQUE INDEX guest_management_access_booking_uniq ON guest_management_access (booking_id);
CREATE INDEX guest_management_access_expiry_idx          ON guest_management_access (expires_at);

COMMIT;
