import { and, desc, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { bookingGuests, bookings, db, guestDocuments, guests, pool } from "@workspace/db";

import { logger } from "./logger";
import { formCState, isForeignNationality, type FeedbackInput, type FormCState, type RegisterRow } from "./compliance-rules.ts";

/**
 * The registers the homestay policy asks for, read from what the site
 * already holds: bookings, the guest's own pre-arrival details and their ID
 * uploads. Two small tables of their own — the Form C filings and the
 * complaints & suggestions book — created at boot and on first use
 * (additive, idempotent), like enquiry_offers.
 */
export const COMPLIANCE_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS form_c_filings (
  booking_id uuid PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  reference text,
  filed_at timestamptz NOT NULL DEFAULT now(),
  filed_by text NOT NULL
);
CREATE TABLE IF NOT EXISTS guest_feedback (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('complaint', 'suggestion', 'compliment')),
  name text NOT NULL,
  contact text,
  stay_ref text,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  owner_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS guest_feedback_created_idx ON guest_feedback (created_at DESC);
`;

let migration: Promise<boolean> | null = null;

export function ensureComplianceTables(): Promise<boolean> {
  if (!migration) {
    migration = pool.query(COMPLIANCE_MIGRATION_SQL).then(
      () => true,
      (error: unknown) => {
        logger.error({ err: error }, "Could not create the compliance tables");
        migration = null;
        return false;
      },
    );
  }
  return migration;
}

async function formCFilings(ids: string[]): Promise<Map<string, { filedAt: Date; reference: string | null }>> {
  const found = new Map<string, { filedAt: Date; reference: string | null }>();
  if (!ids.length || !(await ensureComplianceTables())) return found;
  const { rows } = await pool.query<{ booking_id: string; filed_at: Date; reference: string | null }>(
    `SELECT booking_id, filed_at, reference FROM form_c_filings WHERE booking_id = ANY($1::uuid[])`,
    [ids],
  );
  for (const row of rows) found.set(row.booking_id, { filedAt: row.filed_at, reference: row.reference });
  return found;
}

/** Every stay arriving in the period (by check-in date), with its primary guest, documents and Form C. */
export async function listRegisterRows(period: { from: string | null; to: string | null }): Promise<RegisterRow[]> {
  const conditions = [ne(bookings.status, "cancelled")];
  if (period.from) conditions.push(gte(bookings.checkIn, period.from));
  if (period.to) conditions.push(lte(bookings.checkIn, period.to));

  const stays = await db
    .select({
      id: bookings.id,
      reference: bookings.reference,
      source: bookings.source,
      status: bookings.status,
      checkIn: bookings.checkIn,
      checkOut: bookings.checkOut,
      bookingName: bookings.guestName,
      bookingPhone: bookings.guestPhone,
      guests: bookings.guests,
      pets: bookings.pets,
    })
    .from(bookings)
    .where(and(...conditions))
    .orderBy(bookings.checkIn);

  const ids = stays.map((s) => s.id);
  if (!ids.length) return [];

  const [people, documents, filings] = await Promise.all([
    db
      .select({
        bookingId: bookingGuests.bookingId,
        isPrimary: bookingGuests.isPrimary,
        fullName: guests.fullName,
        phone: guests.phone,
        address: guests.address,
        city: guests.city,
        state: guests.state,
        country: guests.country,
      })
      .from(bookingGuests)
      .innerJoin(guests, eq(guests.id, bookingGuests.guestId))
      .where(inArray(bookingGuests.bookingId, ids))
      .orderBy(desc(bookingGuests.isPrimary), desc(bookingGuests.createdAt)),
    db
      .select({ bookingId: guestDocuments.bookingId, documentType: guestDocuments.documentType })
      .from(guestDocuments)
      .where(and(inArray(guestDocuments.bookingId, ids), isNull(guestDocuments.deletedAt), ne(guestDocuments.status, "rejected"))),
    formCFilings(ids),
  ]);

  const personFor = new Map<string, (typeof people)[number]>();
  for (const p of people) if (!personFor.has(p.bookingId)) personFor.set(p.bookingId, p);
  const docsFor = new Map<string, string[]>();
  for (const d of documents) docsFor.set(d.bookingId, [...(docsFor.get(d.bookingId) ?? []), d.documentType]);

  return stays.map((s) => {
    const person = personFor.get(s.id);
    const filing = filings.get(s.id);
    return {
      bookingId: s.id,
      reference: s.reference,
      source: s.source,
      status: s.status,
      checkIn: s.checkIn,
      checkOut: s.checkOut,
      bookingName: s.bookingName,
      bookingPhone: s.bookingPhone,
      guests: s.guests,
      pets: s.pets,
      guestName: person?.fullName ?? null,
      guestPhone: person?.phone ?? null,
      address: person?.address ?? null,
      city: person?.city ?? null,
      state: person?.state ?? null,
      country: person?.country ?? null,
      documentTypes: docsFor.get(s.id) ?? [],
      formCFiledAt: filing?.filedAt ?? null,
      formCReference: filing?.reference ?? null,
    };
  });
}

export type FormCItem = {
  bookingId: string;
  reference: string | null;
  guestName: string | null;
  country: string | null;
  checkIn: string;
  checkOut: string;
  state: FormCState;
  filedAt: string | null;
  filedReference: string | null;
};

/**
 * Stays around today that need a Form C decision: foreign guests, and guests
 * whose nationality is not known yet (an OTA booking before the pre-arrival
 * form). Indian guests are left out — nothing to do for them.
 */
export async function listFormC(now: Date): Promise<FormCItem[]> {
  const day = 24 * 60 * 60 * 1000;
  const from = new Date(now.getTime() - 30 * day).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 30 * day).toISOString().slice(0, 10);
  const rows = await listRegisterRows({ from, to });
  return rows
    .filter((r) => isForeignNationality(r.country) !== false)
    .map((r) => ({
      bookingId: r.bookingId,
      reference: r.reference,
      guestName: r.guestName ?? r.bookingName,
      country: r.country,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      state: formCState({ country: r.country, checkIn: r.checkIn, filedAt: r.formCFiledAt, now }),
      filedAt: r.formCFiledAt ? r.formCFiledAt.toISOString() : null,
      filedReference: r.formCReference,
    }))
    // Stays that have ended with nationality still unknown are noise.
    .filter((item) => !(item.state === "unknown" && item.checkOut < now.toISOString().slice(0, 10)));
}

export async function markFormCFiled(bookingId: string, reference: string | null, admin: string): Promise<boolean> {
  if (!(await ensureComplianceTables())) return false;
  const { rowCount } = await pool.query(
    `INSERT INTO form_c_filings (booking_id, reference, filed_by) VALUES ($1, $2, $3)
     ON CONFLICT (booking_id) DO UPDATE SET reference = EXCLUDED.reference, filed_by = EXCLUDED.filed_by, filed_at = now()`,
    [bookingId, reference, admin],
  );
  return (rowCount ?? 0) > 0;
}

export async function clearFormCFiled(bookingId: string): Promise<void> {
  if (!(await ensureComplianceTables())) return;
  await pool.query(`DELETE FROM form_c_filings WHERE booking_id = $1`, [bookingId]);
}

// ---------------------------------------------------------------------------
// Complaints & suggestions book
// ---------------------------------------------------------------------------

export type FeedbackEntry = {
  id: string;
  kind: string;
  name: string;
  contact: string | null;
  stayRef: string | null;
  message: string;
  status: "open" | "resolved";
  ownerNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

type FeedbackRow = {
  id: string;
  kind: string;
  name: string;
  contact: string | null;
  stay_ref: string | null;
  message: string;
  status: "open" | "resolved";
  owner_note: string | null;
  created_at: Date;
  resolved_at: Date | null;
};

const toEntry = (r: FeedbackRow): FeedbackEntry => ({
  id: String(r.id),
  kind: r.kind,
  name: r.name,
  contact: r.contact,
  stayRef: r.stay_ref,
  message: r.message,
  status: r.status,
  ownerNote: r.owner_note,
  createdAt: r.created_at.toISOString(),
  resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
});

export async function addFeedback(input: FeedbackInput): Promise<boolean> {
  if (!(await ensureComplianceTables())) return false;
  await pool.query(
    `INSERT INTO guest_feedback (kind, name, contact, stay_ref, message) VALUES ($1, $2, $3, $4, $5)`,
    [input.kind, input.name, input.contact, input.stayRef, input.message],
  );
  return true;
}

export async function listFeedback(): Promise<FeedbackEntry[]> {
  if (!(await ensureComplianceTables())) return [];
  const { rows } = await pool.query<FeedbackRow>(`SELECT * FROM guest_feedback ORDER BY created_at DESC LIMIT 500`);
  return rows.map(toEntry);
}

export async function resolveFeedback(id: string, resolved: boolean, note: string | null): Promise<FeedbackEntry | null> {
  if (!/^\d+$/.test(id) || !(await ensureComplianceTables())) return null;
  const { rows } = await pool.query<FeedbackRow>(
    `UPDATE guest_feedback
        SET status = $2, owner_note = $3, resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE NULL END
      WHERE id = $1 RETURNING *`,
    [id, resolved ? "resolved" : "open", note],
  );
  return rows[0] ? toEntry(rows[0]) : null;
}

/** New entries for the console bell. Never throws: the bell must not break over the book. */
export async function feedbackSince(after: Date, limit: number): Promise<Array<{ id: string; kind: string; name: string; createdAt: Date }>> {
  try {
    if (!(await ensureComplianceTables())) return [];
    const { rows } = await pool.query<{ id: string; kind: string; name: string; created_at: Date }>(
      `SELECT id, kind, name, created_at FROM guest_feedback WHERE created_at >= $1 ORDER BY created_at DESC LIMIT $2`,
      [after, limit],
    );
    return rows.map((r) => ({ id: String(r.id), kind: r.kind, name: r.name, createdAt: r.created_at }));
  } catch (error) {
    logger.error({ err: error }, "Could not read new feedback for the activity bell");
    return [];
  }
}
