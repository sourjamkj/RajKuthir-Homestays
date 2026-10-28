import { createHash } from "node:crypto";
import { pool } from "@workspace/db";

import { logger } from "./logger";
import type { MailMessage, SyncableAccount } from "./mail-sync";
import { fileDocument, type OtaDocumentKind } from "./ota-documents-rules";

/**
 * PDFs from OTA emails, kept in Postgres (as guest documents are) so the
 * owner can open or forward them from the console: a guest's booking
 * voucher — which shows the taxes the OTA charged them — and the monthly
 * commission statements.
 *
 * Saved by the mail sync as it reads each message, plus a one-off pass over
 * the OTA emails already in the mailbox. The same PDF is stored once,
 * however many times its email is read (unique on its SHA-256).
 *
 * Linked to bookings at READ time by the channel's booking number, so a
 * voucher that arrives before its booking row exists still shows up later.
 */

export const OTA_DOCUMENTS_SQL = `
CREATE TABLE IF NOT EXISTS ota_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256        text NOT NULL,
  source        text NOT NULL,
  kind          text NOT NULL,
  external_ref  text,
  period        text,
  filename      text NOT NULL,
  mime          text NOT NULL,
  size_bytes    integer NOT NULL,
  bytes         bytea NOT NULL,
  email_subject text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ota_document_sha_uniq ON ota_documents (sha256);
CREATE INDEX        IF NOT EXISTS ota_document_ref_idx  ON ota_documents (external_ref);
CREATE INDEX        IF NOT EXISTS ota_document_kind_idx ON ota_documents (kind, period);
`;

let ready: Promise<boolean> | null = null;

export function ensureOtaDocumentTables(): Promise<boolean> {
  if (!ready) {
    ready = pool
      .query(OTA_DOCUMENTS_SQL)
      .then(() => true)
      .catch((error) => {
        logger.error({ err: error }, "Could not create the OTA documents table");
        ready = null;
        return false;
      });
  }
  return ready;
}

/** Files every PDF attached to OTA emails in this batch. Never throws. */
export async function saveOtaDocuments(messages: MailMessage[]): Promise<number> {
  let saved = 0;
  try {
    if (!messages.some((message) => message.attachments?.length)) return 0;
    if (!(await ensureOtaDocumentTables())) return 0;
    for (const message of messages) {
      if (!message.attachments?.length) continue;
      const filed = fileDocument({ from: message.from, subject: message.subject });
      if (!filed) continue;
      for (const file of message.attachments) {
        const sha = createHash("sha256").update(file.content).digest("hex");
        const { rowCount } = await pool.query(
          `INSERT INTO ota_documents (sha256, source, kind, external_ref, period, filename, mime, size_bytes, bytes, email_subject)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (sha256) DO NOTHING`,
          [sha, filed.source, filed.kind, filed.externalRef, filed.period, file.filename.slice(0, 200), file.contentType, file.content.length, file.content, message.subject.slice(0, 300)],
        );
        saved += rowCount ?? 0;
      }
    }
    if (saved) logger.info({ saved }, "OTA documents saved");
  } catch (error) {
    logger.error({ err: error }, "Saving OTA documents failed");
  }
  return saved;
}

export type OtaDocumentMeta = {
  id: string;
  source: string;
  kind: OtaDocumentKind;
  externalRef: string | null;
  period: string | null;
  filename: string;
  sizeBytes: number;
  emailSubject: string | null;
  createdAt: Date;
};

const META = `id, source, kind, external_ref AS "externalRef", period, filename, size_bytes AS "sizeBytes", email_subject AS "emailSubject", created_at AS "createdAt"`;

/** Documents for these channel booking numbers, newest first. */
export async function documentsForRefs(refs: string[]): Promise<Map<string, OtaDocumentMeta[]>> {
  const out = new Map<string, OtaDocumentMeta[]>();
  const wanted = refs.filter(Boolean);
  if (!wanted.length || !(await ensureOtaDocumentTables())) return out;
  const { rows } = await pool.query<OtaDocumentMeta>(
    `SELECT ${META} FROM ota_documents WHERE external_ref = ANY($1::text[]) ORDER BY created_at DESC`,
    [wanted],
  );
  for (const row of rows) {
    out.set(row.externalRef!, [...(out.get(row.externalRef!) ?? []), row]);
  }
  return out;
}

/** Monthly statements and anything not tied to a booking. */
export async function listStatements(limit = 60): Promise<OtaDocumentMeta[]> {
  if (!(await ensureOtaDocumentTables())) return [];
  const { rows } = await pool.query<OtaDocumentMeta>(
    `SELECT ${META} FROM ota_documents WHERE kind = 'statement' OR external_ref IS NULL
     ORDER BY COALESCE(period, to_char(created_at, 'YYYY-MM')) DESC, created_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function getOtaDocument(id: string): Promise<{ filename: string; mime: string; bytes: Buffer } | null> {
  if (!(await ensureOtaDocumentTables())) return null;
  const { rows } = await pool.query<{ filename: string; mime: string; bytes: Buffer }>(
    "SELECT filename, mime, bytes FROM ota_documents WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

/* ------------------------- one-off: what is already there ------------------------- */

const BACKFILL_KEY = "mail.backfill.otaDocuments";
const DOMAINS = ["go-mmt.com", "goibibo.com", "makemytrip.com", "zen2-makemytrip.com", "booking.com", "airbnb.com"];

/**
 * Reads the OTA emails already in each mailbox (IMAP SEARCH by sender, the
 * last 300 per domain) and files their PDFs. Bookings are not touched.
 * Marked done once it completes for every mailbox.
 */
export async function backfillOtaDocuments(
  accounts: SyncableAccount[],
  readBySender: (account: SyncableAccount, domain: string, limit: number) => Promise<MailMessage[]>,
): Promise<number> {
  if (!accounts.length || !(await ensureOtaDocumentTables())) return 0;
  const { rows } = await pool.query<{ value: string }>("SELECT value FROM app_settings WHERE key = $1", [BACKFILL_KEY]);
  if (rows[0]) return 0;

  let saved = 0;
  for (const account of accounts) {
    for (const domain of DOMAINS) {
      try {
        saved += await saveOtaDocuments(await readBySender(account, domain, 300));
      } catch (error) {
        logger.warn({ err: error instanceof Error ? error.message : error, domain }, "OTA document backfill read failed");
        return saved; // try again on the next start
      }
    }
  }
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [BACKFILL_KEY, JSON.stringify({ at: new Date().toISOString(), saved })],
  );
  logger.info({ saved }, "OTA document backfill finished");
  return saved;
}
