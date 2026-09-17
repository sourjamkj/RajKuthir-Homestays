-- Guest pre-arrival verification and document collection.
--
-- guest-management-access.sql covers the management bearer-link table. This
-- file covers the other four tables that feature added, which had no migration
-- of their own: without them the whole /pre-arrival flow fails at the first
-- query on a database that has not had `drizzle-kit push` run against it.
--
-- Mirrors lib/db/src/schema/guests.ts. Safe to run more than once.

-- ---------------------------------------------------------------- enums
-- CREATE TYPE has no IF NOT EXISTS, so each one is guarded.
DO $$ BEGIN
  CREATE TYPE guest_document_status AS ENUM ('pending', 'submitted', 'verified', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE guest_onboarding_status AS ENUM ('pending', 'submitted', 'verified', 'expired', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- --------------------------------------------------------------- guests
-- The canonical guest, keyed in practice by phone: the booking row keeps its
-- own name/phone snapshot as it arrived from the channel, and is not touched.
CREATE TABLE IF NOT EXISTS guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  phone text NOT NULL,
  email text,
  address text,
  city text,
  state text,
  country text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guest_phone_idx ON guests (phone);

-- -------------------------------------------------------- booking_guests
CREATE TABLE IF NOT EXISTS booking_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_guest_pair_uniq ON booking_guests (booking_id, guest_id);
CREATE INDEX IF NOT EXISTS booking_guest_booking_idx ON booking_guests (booking_id);
CREATE INDEX IF NOT EXISTS booking_guest_guest_idx ON booking_guests (guest_id);

-- ------------------------------------------------------- guest_documents
-- file_data is the document itself, as bytea. Identity documents are the most
-- sensitive thing this database holds: deleted_at exists so a document can be
-- retired without losing the record that it was once supplied, and nothing
-- here is served without a live capability token.
CREATE TABLE IF NOT EXISTS guest_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  document_number text,
  source text NOT NULL DEFAULT 'upload',
  original_filename text,
  mime_type text,
  size_bytes integer,
  file_data bytea,
  external_reference text,
  status guest_document_status NOT NULL DEFAULT 'submitted',
  rejection_reason text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  verified_by text,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS guest_document_guest_idx ON guest_documents (guest_id);
CREATE INDEX IF NOT EXISTS guest_document_booking_idx ON guest_documents (booking_id);
CREATE INDEX IF NOT EXISTS guest_document_status_idx ON guest_documents (status);

-- ------------------------------------------------------ guest_onboarding
-- One row per booking. token_hash is a SHA-256 of the capability token; the
-- token itself is never stored, so a database dump does not hand anyone a
-- working link.
CREATE TABLE IF NOT EXISTS guest_onboarding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  verification_deadline timestamptz NOT NULL,
  status guest_onboarding_status NOT NULL DEFAULT 'pending',
  last_sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS guest_onboarding_token_uniq ON guest_onboarding (token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS guest_onboarding_booking_uniq ON guest_onboarding (booking_id);
CREATE INDEX IF NOT EXISTS guest_onboarding_expiry_idx ON guest_onboarding (expires_at);

-- After running this and guest-management-access.sql, all five tables should
-- be present:
--   SELECT table_name FROM information_schema.tables
--    WHERE table_name IN ('guests','booking_guests','guest_documents',
--                         'guest_onboarding','guest_management_access');
