-- Reconcile the live guest-verification tables with the Drizzle schema.
--
-- WHY THIS FILE EXISTS
--
-- Production was answering GET /api/admin/guest-stays with a 500. The Railway
-- deploy log gives the exact reason:
--
--   select "booking_id", "status" from "guest_documents"
--     where "guest_documents"."deleted_at" is null
--   ERROR 42703 (undefined_column) at position 8
--
-- 42703 is "undefined column", not 42P01 "undefined table" — so
-- guest_documents EXISTS in Railway Postgres but was created with a different
-- column set from the one lib/db/src/schema/guests.ts expects. Every admin
-- readiness query therefore failed, which is why the Guest Check-in Readiness
-- panel showed "No bookings yet" and why the Guest List WhatsApp button fell
-- back to a generic message instead of the booking-specific one.
--
-- WHAT THIS FILE DOES
--
-- Brings whatever is currently in the database up to the shape the code
-- expects, without dropping or recreating anything:
--
--   * creates any of the five tables that are missing outright
--   * renames a column when an earlier name is present and the current one is
--     not (name -> full_name, document_data -> file_data, and similar), so the
--     data inside it is preserved rather than stranded
--   * adds any missing column, always NULLABLE first, so the statement cannot
--     fail against a table that already holds rows
--   * tightens a column to NOT NULL only when no NULLs remain in it
--
-- It does NOT touch the bookings table, booking financial fields, or any
-- existing booking row.
--
-- Safe to run more than once. Run this BEFORE the next deploy.

-- ------------------------------------------------------------------ enums
DO $$ BEGIN
  CREATE TYPE guest_document_status AS ENUM ('pending', 'submitted', 'verified', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE guest_onboarding_status AS ENUM ('pending', 'submitted', 'verified', 'expired', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Older installs may be missing the newer statuses on an existing enum.
DO $$ BEGIN
  ALTER TYPE guest_onboarding_status ADD VALUE IF NOT EXISTS 'expired';
  ALTER TYPE guest_onboarding_status ADD VALUE IF NOT EXISTS 'blocked';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ---------------------------------------------------------------- helpers
-- Rename a column only when the old name is present and the new one is not.
-- Anything else is a no-op, which is what makes this file re-runnable.
CREATE OR REPLACE FUNCTION rk_rename_column_if_needed(
  p_table text,
  p_from  text,
  p_to    text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = p_table AND column_name = p_from
     )
     AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = p_table AND column_name = p_to
     )
  THEN
    EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO %I', p_table, p_from, p_to);
    RAISE NOTICE 'renamed %.% to %', p_table, p_from, p_to;
  END IF;
END $$;

-- Set NOT NULL only when the column holds no NULLs, so this never aborts the
-- migration over pre-existing rows.
CREATE OR REPLACE FUNCTION rk_set_not_null_if_clean(
  p_table text,
  p_column text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  nulls bigint;
BEGIN
  IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = p_table AND column_name = p_column
     ) THEN
    RETURN;
  END IF;

  EXECUTE format('SELECT count(*) FROM %I WHERE %I IS NULL', p_table, p_column) INTO nulls;

  IF nulls = 0 THEN
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET NOT NULL', p_table, p_column);
  ELSE
    RAISE NOTICE '%.% left nullable: % row(s) still NULL', p_table, p_column, nulls;
  END IF;
END $$;

-- ----------------------------------------------------------------- guests
CREATE TABLE IF NOT EXISTS guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

-- An earlier cut of this table called it "name".
SELECT rk_rename_column_if_needed('guests', 'name', 'full_name');

ALTER TABLE guests ADD COLUMN IF NOT EXISTS full_name  text;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS phone      text;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS email      text;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS address    text;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS city       text;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS state      text;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS country    text;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE guests ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

SELECT rk_set_not_null_if_clean('guests', 'full_name');
SELECT rk_set_not_null_if_clean('guests', 'phone');

CREATE INDEX IF NOT EXISTS guest_phone_idx ON guests (phone);

-- --------------------------------------------------------- booking_guests
CREATE TABLE IF NOT EXISTS booking_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

ALTER TABLE booking_guests ADD COLUMN IF NOT EXISTS booking_id uuid;
ALTER TABLE booking_guests ADD COLUMN IF NOT EXISTS guest_id   uuid;
ALTER TABLE booking_guests ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;
ALTER TABLE booking_guests ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

SELECT rk_set_not_null_if_clean('booking_guests', 'booking_id');
SELECT rk_set_not_null_if_clean('booking_guests', 'guest_id');

DO $$ BEGIN
  ALTER TABLE booking_guests
    ADD CONSTRAINT booking_guests_booking_fk
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE booking_guests
    ADD CONSTRAINT booking_guests_guest_fk
    FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS booking_guest_pair_uniq ON booking_guests (booking_id, guest_id);
CREATE INDEX IF NOT EXISTS booking_guest_booking_idx ON booking_guests (booking_id);
CREATE INDEX IF NOT EXISTS booking_guest_guest_idx   ON booking_guests (guest_id);

-- -------------------------------------------------------- guest_documents
-- This is the table that was actually broken in production.
CREATE TABLE IF NOT EXISTS guest_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

-- Earlier column names seen in hand-written DDL for this table.
SELECT rk_rename_column_if_needed('guest_documents', 'document_data', 'file_data');
SELECT rk_rename_column_if_needed('guest_documents', 'data',          'file_data');
SELECT rk_rename_column_if_needed('guest_documents', 'filename',      'original_filename');
SELECT rk_rename_column_if_needed('guest_documents', 'content_type',  'mime_type');
SELECT rk_rename_column_if_needed('guest_documents', 'size',          'size_bytes');

ALTER TABLE guest_documents ADD COLUMN IF NOT EXISTS guest_id           uuid;
-- The missing column that produced ERROR 42703.
ALTER TABLE guest_documents ADD COLUMN IF NOT EXISTS booking_id         uuid;
ALTER TABLE guest_documents ADD COLUMN IF NOT EXISTS document_type      text;
ALTER TABLE guest_documents ADD COLUMN IF NOT EXISTS document_number    text;
ALTER TABLE guest_documents ADD COLUMN IF NOT EXISTS source             text NOT NULL DEFAULT 'upload';
ALTER TABLE guest_documents ADD COLUMN IF NOT EXISTS original_filename  text;
ALTER TABLE guest_documents ADD COLUMN IF NOT EXISTS mime_type          text;
ALTER TABLE guest_documents ADD COLUMN IF NOT EXISTS size_bytes         integer;
ALTER TABLE guest_documents ADD COLUMN IF NOT EXISTS file_data          bytea;
ALTER TABLE guest_documents ADD COLUMN IF NOT EXISTS external_reference text;
ALTER TABLE guest_documents ADD COLUMN IF NOT EXISTS rejection_reason   text;
ALTER TABLE guest_documents ADD COLUMN IF NOT EXISTS uploaded_at        timestamptz NOT NULL DEFAULT now();
ALTER TABLE guest_documents ADD COLUMN IF NOT EXISTS verified_at        timestamptz;
ALTER TABLE guest_documents ADD COLUMN IF NOT EXISTS verified_by        text;
-- The other column named in the failing query.
ALTER TABLE guest_documents ADD COLUMN IF NOT EXISTS deleted_at         timestamptz;

-- status must be the enum type; add it only if absent so an existing column
-- (of whatever type) is left alone for a human to look at.
DO $$ BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_name = 'guest_documents' AND column_name = 'status'
     ) THEN
    ALTER TABLE guest_documents
      ADD COLUMN status guest_document_status NOT NULL DEFAULT 'submitted';
  END IF;
END $$;

SELECT rk_set_not_null_if_clean('guest_documents', 'guest_id');
SELECT rk_set_not_null_if_clean('guest_documents', 'booking_id');
SELECT rk_set_not_null_if_clean('guest_documents', 'document_type');

DO $$ BEGIN
  ALTER TABLE guest_documents
    ADD CONSTRAINT guest_documents_guest_fk
    FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE guest_documents
    ADD CONSTRAINT guest_documents_booking_fk
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS guest_document_guest_idx   ON guest_documents (guest_id);
CREATE INDEX IF NOT EXISTS guest_document_booking_idx ON guest_documents (booking_id);
CREATE INDEX IF NOT EXISTS guest_document_status_idx  ON guest_documents (status);

-- ------------------------------------------------------- guest_onboarding
CREATE TABLE IF NOT EXISTS guest_onboarding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

-- The token is stored hashed. If an earlier install kept the raw value in a
-- "token" column, it is renamed rather than silently shadowed — see the note
-- at the end of this file, because its contents are NOT a valid hash.
SELECT rk_rename_column_if_needed('guest_onboarding', 'token', 'token_hash');
SELECT rk_rename_column_if_needed('guest_onboarding', 'deadline', 'verification_deadline');

ALTER TABLE guest_onboarding ADD COLUMN IF NOT EXISTS booking_id            uuid;
ALTER TABLE guest_onboarding ADD COLUMN IF NOT EXISTS token_hash            text;
ALTER TABLE guest_onboarding ADD COLUMN IF NOT EXISTS expires_at            timestamptz;
ALTER TABLE guest_onboarding ADD COLUMN IF NOT EXISTS verification_deadline timestamptz;
ALTER TABLE guest_onboarding ADD COLUMN IF NOT EXISTS last_sent_at          timestamptz;
ALTER TABLE guest_onboarding ADD COLUMN IF NOT EXISTS completed_at          timestamptz;
ALTER TABLE guest_onboarding ADD COLUMN IF NOT EXISTS created_at            timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_name = 'guest_onboarding' AND column_name = 'status'
     ) THEN
    ALTER TABLE guest_onboarding
      ADD COLUMN status guest_onboarding_status NOT NULL DEFAULT 'pending';
  END IF;
END $$;

SELECT rk_set_not_null_if_clean('guest_onboarding', 'booking_id');
SELECT rk_set_not_null_if_clean('guest_onboarding', 'token_hash');
SELECT rk_set_not_null_if_clean('guest_onboarding', 'expires_at');
SELECT rk_set_not_null_if_clean('guest_onboarding', 'verification_deadline');

DO $$ BEGIN
  ALTER TABLE guest_onboarding
    ADD CONSTRAINT guest_onboarding_booking_fk
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS guest_onboarding_token_uniq   ON guest_onboarding (token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS guest_onboarding_booking_uniq ON guest_onboarding (booking_id);
CREATE INDEX        IF NOT EXISTS guest_onboarding_expiry_idx   ON guest_onboarding (expires_at);

-- ------------------------------------------------ guest_management_access
CREATE TABLE IF NOT EXISTS guest_management_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

SELECT rk_rename_column_if_needed('guest_management_access', 'token', 'token_hash');

ALTER TABLE guest_management_access ADD COLUMN IF NOT EXISTS booking_id uuid;
ALTER TABLE guest_management_access ADD COLUMN IF NOT EXISTS token_hash text;
ALTER TABLE guest_management_access ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE guest_management_access ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

SELECT rk_set_not_null_if_clean('guest_management_access', 'booking_id');
SELECT rk_set_not_null_if_clean('guest_management_access', 'token_hash');
SELECT rk_set_not_null_if_clean('guest_management_access', 'expires_at');

DO $$ BEGIN
  ALTER TABLE guest_management_access
    ADD CONSTRAINT guest_management_access_booking_fk
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS guest_management_access_token_uniq   ON guest_management_access (token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS guest_management_access_booking_uniq ON guest_management_access (booking_id);
CREATE INDEX        IF NOT EXISTS guest_management_access_expiry_idx   ON guest_management_access (expires_at);

-- ---------------------------------------------------------------- tidy up
DROP FUNCTION IF EXISTS rk_rename_column_if_needed(text, text, text);
DROP FUNCTION IF EXISTS rk_set_not_null_if_clean(text, text);

-- ================================================================= CHECKS
--
-- 1. Every column the code reads should now exist. This must return 0 rows:
--
--    SELECT required.table_name, required.column_name
--      FROM (VALUES
--        ('guest_documents','booking_id'), ('guest_documents','guest_id'),
--        ('guest_documents','file_data'),  ('guest_documents','deleted_at'),
--        ('guest_documents','status'),     ('guest_onboarding','token_hash'),
--        ('guest_onboarding','verification_deadline'),
--        ('guest_management_access','token_hash'), ('guests','full_name')
--      ) AS required(table_name, column_name)
--     WHERE NOT EXISTS (
--       SELECT 1 FROM information_schema.columns c
--        WHERE c.table_name = required.table_name
--          AND c.column_name = required.column_name);
--
-- 2. Any column this file had to leave nullable is listed by the NOTICEs it
--    raised while running. Those rows predate the reconcile and are worth a
--    look before the column is tightened by hand.
--
-- 3. If the rename of guest_onboarding.token -> token_hash actually fired, the
--    values in that column are RAW TOKENS, not SHA-256 hashes, and no existing
--    link will validate. Issue fresh links (Send Info in /admin/guests) for any
--    affected booking; clearing the stale rows is safe:
--      DELETE FROM guest_onboarding WHERE length(token_hash) <> 64;
--      DELETE FROM guest_management_access WHERE length(token_hash) <> 64;
