-- Idempotency key for Meta Flow submissions. Existing enquiries remain NULL.
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS whatsapp_submission_id text;
CREATE UNIQUE INDEX IF NOT EXISTS enquiries_whatsapp_submission_id_unique
  ON enquiries (whatsapp_submission_id);
