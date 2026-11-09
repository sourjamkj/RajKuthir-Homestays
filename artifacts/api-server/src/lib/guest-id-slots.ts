import { pool } from "@workspace/db";
import { logger } from "./logger";
import type { GuestAge, IdTypeKey } from "./guest-id-rules.ts";

/**
 * Which guest, which ID and which side each uploaded file belongs to.
 *
 * Kept beside guest_documents rather than as new columns on it: that table is
 * in the Drizzle schema, and a column the code selects before the database has
 * it is exactly the drift that took production down before (schema-check.ts).
 * This table is created at boot (additive, idempotent) and only ever read with
 * plain SQL, so an old document simply has no slot row and reads as an
 * earlier, ungrouped upload.
 */
const SQL = `
CREATE TABLE IF NOT EXISTS guest_document_slots (
  document_id uuid PRIMARY KEY REFERENCES guest_documents(id) ON DELETE CASCADE,
  booking_id  uuid NOT NULL,
  slot        integer NOT NULL,
  guest_name  text NOT NULL,
  guest_age   text NOT NULL,
  id_type     text NOT NULL,
  side        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guest_document_slots_booking_idx ON guest_document_slots (booking_id);
`;

let ready: Promise<boolean> | null = null;
export function ensureGuestDocumentSlots(): Promise<boolean> {
  if (!ready) {
    ready = pool.query(SQL).then(
      () => true,
      (error: unknown) => {
        logger.error({ err: error }, "Could not create guest_document_slots");
        ready = null;
        return false;
      },
    );
  }
  return ready;
}

export type SlotRow = {
  documentId: string;
  slot: number;
  guestName: string;
  guestAge: GuestAge;
  idType: IdTypeKey;
  side: string;
};

/** Slot rows for the live documents of a booking, with each document's status and reason. */
export async function slotsForBooking(bookingId: string): Promise<Array<SlotRow & { status: string; rejectionReason: string | null }>> {
  if (!(await ensureGuestDocumentSlots())) return [];
  const { rows } = await pool.query<{
    document_id: string; slot: number; guest_name: string; guest_age: GuestAge; id_type: IdTypeKey; side: string; status: string; rejection_reason: string | null;
  }>(
    `SELECT s.document_id, s.slot, s.guest_name, s.guest_age, s.id_type, s.side, d.status, d.rejection_reason
       FROM guest_document_slots s
       JOIN guest_documents d ON d.id = s.document_id
      WHERE s.booking_id = $1 AND d.deleted_at IS NULL
      ORDER BY s.slot, s.created_at`,
    [bookingId],
  );
  return rows.map((r) => ({
    documentId: r.document_id, slot: r.slot, guestName: r.guest_name, guestAge: r.guest_age,
    idType: r.id_type, side: r.side, status: r.status, rejectionReason: r.rejection_reason,
  }));
}

/** Guests listed (distinct slots with a live document) per booking, for the stays list. */
export async function listedGuestCounts(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!(await ensureGuestDocumentSlots())) return out;
  const { rows } = await pool.query<{ booking_id: string; n: number }>(
    `SELECT s.booking_id, count(DISTINCT s.slot)::int AS n
       FROM guest_document_slots s JOIN guest_documents d ON d.id = s.document_id
      WHERE d.deleted_at IS NULL GROUP BY s.booking_id`,
  );
  for (const r of rows) out.set(r.booking_id, r.n);
  return out;
}

/** Live document ids for one guest of a booking. */
export async function documentIdsForSlot(bookingId: string, slot: number): Promise<string[]> {
  if (!(await ensureGuestDocumentSlots())) return [];
  const { rows } = await pool.query<{ document_id: string }>(
    `SELECT s.document_id FROM guest_document_slots s JOIN guest_documents d ON d.id = s.document_id
      WHERE s.booking_id = $1 AND s.slot = $2 AND d.deleted_at IS NULL`,
    [bookingId, slot],
  );
  return rows.map((r) => r.document_id);
}
