-- Required by the management document-access flow.
-- Run once in Railway PostgreSQL if this table does not already exist.

CREATE TABLE IF NOT EXISTS guest_management_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guest_management_access_token_uniq UNIQUE (token_hash),
  CONSTRAINT guest_management_access_booking_uniq UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS guest_management_access_expiry_idx
  ON guest_management_access (expires_at);
