-- The five guest verification tables, as lib/db/src/schema/guests.ts defines them.
--
-- WHY THIS FILE EXISTS
--
-- These tables reached production by hand. The original DDL predated the
-- Drizzle schema and drifted from it; the drift was then chased with three
-- patch files — guest-schema-reconcile.sql added columns the code expected,
-- guest-relax-legacy-columns.sql dropped NOT NULL on columns the code had
-- never heard of, and guest-management-access.sql added the newest table —
-- before the five were finally dropped and rebuilt through a psql session.
-- That rebuild fixed the database and left the repository with no migration
-- that creates `guests` at all, which is what
-- "onboarding · every table the feature queries has a migration" caught.
--
-- So this is the canonical definition: one file, every table, transcribed from
-- the Drizzle schema rather than from memory of what production happens to
-- hold. A fresh database gets the right shape from here in one step.
--
-- SAFE TO RUN ON THE LIVE DATABASE. Every statement is IF NOT EXISTS and
-- nothing is dropped, altered or backfilled — on production, where all five
-- tables already exist, this file is a no-op that only records the truth.
--
-- Run with:  railway connect Postgres   then  \i guest-tables.sql
-- (Railway's Data tab appends LIMIT to whatever you paste, which turns DDL
--  into a syntax error. Use the psql session, not the web query box.)

-- ==================================================================== ENUMS
-- CREATE TYPE has no IF NOT EXISTS, so each one is guarded by hand.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'guest_document_status') THEN
    CREATE TYPE guest_document_status AS ENUM ('pending', 'submitted', 'verified', 'rejected');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'guest_onboarding_status') THEN
    CREATE TYPE guest_onboarding_status AS ENUM ('pending', 'submitted', 'verified', 'expired', 'blocked');
  END IF;
END $$;

-- =================================================================== GUESTS
-- The canonical guest profile. Booking rows keep their own name/phone
-- snapshot from the time of booking; this is the person, not the booking.

CREATE TABLE IF NOT EXISTS guests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   text NOT NULL,
  phone       text NOT NULL,
  email       text,
  address     text,
  city        text,
  state       text,
  country     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Guests are looked up by phone on every submission, never by name.
CREATE INDEX IF NOT EXISTS guest_phone_idx ON guests (phone);

-- =========================================================== BOOKING_GUESTS
-- Which people are on which stay. A booking may gather several guests, and a
-- returning guest keeps one profile across their bookings.

CREATE TABLE IF NOT EXISTS booking_guests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  guest_id    uuid NOT NULL REFERENCES guests (id) ON DELETE CASCADE,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per person per stay; submitting twice must not duplicate the pair.
CREATE UNIQUE INDEX IF NOT EXISTS booking_guest_pair_uniq ON booking_guests (booking_id, guest_id);
CREATE INDEX IF NOT EXISTS booking_guest_booking_idx ON booking_guests (booking_id);
CREATE INDEX IF NOT EXISTS booking_guest_guest_idx ON booking_guests (guest_id);

-- ========================================================== GUEST_DOCUMENTS
-- Identity documents. file_data holds the bytes in the database rather than on
-- disk or in a bucket: these are scans of government ID and there is no
-- object store here that is not a public URL waiting to be guessed.
--
-- deleted_at is a soft delete. A document the owner rejected and the guest has
-- replaced is superseded, not erased — the row, the file and the rejection
-- reason all survive for the record.

CREATE TABLE IF NOT EXISTS guest_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id            uuid NOT NULL REFERENCES guests (id) ON DELETE CASCADE,
  booking_id          uuid NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  document_type       text NOT NULL,
  document_number     text,
  source              text NOT NULL DEFAULT 'upload',
  original_filename   text,
  mime_type           text,
  size_bytes          integer,
  file_data           bytea,
  external_reference  text,
  status              guest_document_status NOT NULL DEFAULT 'submitted',
  rejection_reason    text,
  uploaded_at         timestamptz NOT NULL DEFAULT now(),
  verified_at         timestamptz,
  verified_by         text,
  deleted_at          timestamptz
);

CREATE INDEX IF NOT EXISTS guest_document_guest_idx ON guest_documents (guest_id);
CREATE INDEX IF NOT EXISTS guest_document_booking_idx ON guest_documents (booking_id);
CREATE INDEX IF NOT EXISTS guest_document_status_idx ON guest_documents (status);

-- ========================================================= GUEST_ONBOARDING
-- One pre-arrival verification link per booking.
--
-- token_hash, never the token: the raw value is shown once, in the URL
-- fragment of the link sent to the guest, and is not recoverable from here.
-- Re-issuing a link overwrites this row's hash, which is what invalidates the
-- previous one.

CREATE TABLE IF NOT EXISTS guest_onboarding (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id             uuid NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  token_hash             text NOT NULL,
  expires_at             timestamptz NOT NULL,
  verification_deadline  timestamptz NOT NULL,
  status                 guest_onboarding_status NOT NULL DEFAULT 'pending',
  last_sent_at           timestamptz,
  completed_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS guest_onboarding_token_uniq ON guest_onboarding (token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS guest_onboarding_booking_uniq ON guest_onboarding (booking_id);
CREATE INDEX IF NOT EXISTS guest_onboarding_expiry_idx ON guest_onboarding (expires_at);

-- ================================================== GUEST_MANAGEMENT_ACCESS
-- A separate bearer link for property management to view a stay's documents.
-- Separate from guest_onboarding on purpose: the two are issued to different
-- people, expire on different clocks, and revoking one must not revoke the
-- other.

CREATE TABLE IF NOT EXISTS guest_management_access (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS guest_management_access_token_uniq ON guest_management_access (token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS guest_management_access_booking_uniq ON guest_management_access (booking_id);
CREATE INDEX IF NOT EXISTS guest_management_access_expiry_idx ON guest_management_access (expires_at);

-- ================================================================== CHECKS
--
-- 1. All five tables present:
--
--      SELECT table_name FROM information_schema.tables
--       WHERE table_schema = 'public'
--         AND table_name IN ('guests','booking_guests','guest_documents',
--                            'guest_onboarding','guest_management_access')
--       ORDER BY table_name;      -- expect 5 rows
--
-- 2. Nothing NOT NULL that the code does not write — the failure mode that
--    produced ERROR 23502 on every insert last time:
--
--      SELECT table_name, column_name
--        FROM information_schema.columns
--       WHERE table_schema = 'public'
--         AND table_name IN ('guests','booking_guests','guest_documents',
--                            'guest_onboarding','guest_management_access')
--         AND is_nullable = 'NO'
--         AND column_default IS NULL
--         AND column_name NOT IN (
--           'booking_id','guest_id','token_hash','expires_at',
--           'verification_deadline','full_name','phone','document_type');
--                                 -- expect no rows
