import { and, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { bookings, db, enquiries, pool, type Booking } from "@workspace/db";

import { logger } from "./logger";
import { sendEmail } from "./book-pay-notify";
import { renderInvoicePdf } from "./invoice-pdf";
import { documentsForRefs, type OtaDocumentMeta } from "./ota-documents";
import {
  AUTO_EMAIL_SOURCES,
  SEND_WINDOW_DAYS,
  autoEmailDecision,
  financialYear,
  invoiceContent,
  invoiceEmail,
  invoiceNumber,
  invoiceProblem,
  istDateOf,
  nextSequence,
  type InvoiceContent,
} from "./invoice-rules";

/**
 * Guest invoices: issued once per booking with a number that never changes,
 * rendered as a PDF on demand from the booking's current figures, and
 * emailed automatically at noon on check-out day for our own bookings.
 *
 * The table is created at boot (additive). It keeps the number, the issue
 * date and the email record; the PDF itself is always rendered fresh, so a
 * corrected total shows on a re-download without re-numbering.
 */

export const INVOICES_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS guest_invoices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid REFERENCES bookings(id) ON DELETE SET NULL,
  number      text NOT NULL,
  issued_on   date NOT NULL,
  emailed_at  timestamptz,
  email_to    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS guest_invoice_number_uniq  ON guest_invoices (number);
CREATE UNIQUE INDEX IF NOT EXISTS guest_invoice_booking_uniq ON guest_invoices (booking_id);
`;

const LOCK_KEY = 7_302_031;

let ready: Promise<boolean> | null = null;

export function ensureInvoiceTables(): Promise<boolean> {
  if (!ready) {
    ready = pool
      .query(INVOICES_MIGRATION_SQL)
      .then(() => true)
      .catch((error) => {
        logger.error({ err: error }, "Could not create the invoices table");
        ready = null;
        return false;
      });
  }
  return ready;
}

type InvoiceRow = { id: string; booking_id: string | null; number: string; issued_on: string; emailed_at: Date | null; email_to: string | null };

async function invoiceRow(bookingId: string): Promise<InvoiceRow | null> {
  const { rows } = await pool.query<InvoiceRow>(
    "SELECT id, booking_id, number, to_char(issued_on, 'YYYY-MM-DD') AS issued_on, emailed_at, email_to FROM guest_invoices WHERE booking_id = $1",
    [bookingId],
  );
  return rows[0] ?? null;
}

/** The guest's email, from the enquiry the booking came from. Bookings themselves hold none. */
export async function guestEmailFor(bookingId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: enquiries.email })
    .from(enquiries)
    .where(and(eq(enquiries.convertedBookingId, bookingId), isNotNull(enquiries.email)))
    .orderBy(desc(enquiries.createdAt))
    .limit(1);
  return row?.email?.trim() || null;
}

/** The invoice number for a booking, issuing one the first time. */
async function issue(booking: Booking, now: Date): Promise<InvoiceRow> {
  const existing = await invoiceRow(booking.id);
  if (existing) return existing;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
    const again = await client.query<InvoiceRow>(
      "SELECT id, booking_id, number, to_char(issued_on, 'YYYY-MM-DD') AS issued_on, emailed_at, email_to FROM guest_invoices WHERE booking_id = $1",
      [booking.id],
    );
    if (again.rows[0]) {
      await client.query("COMMIT");
      return again.rows[0];
    }
    const issuedOn = istDateOf(now);
    const fy = financialYear(issuedOn);
    const { rows } = await client.query<{ number: string }>("SELECT number FROM guest_invoices WHERE number LIKE $1", [`RK/${fy}/%`]);
    const number = invoiceNumber(fy, nextSequence(fy, rows.map((row) => row.number)));
    const inserted = await client.query<InvoiceRow>(
      `INSERT INTO guest_invoices (booking_id, number, issued_on) VALUES ($1, $2, $3)
       RETURNING id, booking_id, number, to_char(issued_on, 'YYYY-MM-DD') AS issued_on, emailed_at, email_to`,
      [booking.id, number, issuedOn],
    );
    await client.query("COMMIT");
    logger.info({ bookingId: booking.id, number }, "Invoice issued");
    return inserted.rows[0]!;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export type BuiltInvoice = { content: InvoiceContent; pdf: Uint8Array; filename: string };

export async function buildInvoice(
  bookingId: string,
  now = new Date(),
): Promise<{ ok: true; invoice: BuiltInvoice } | { ok: false; status: number; error: string }> {
  if (!(await ensureInvoiceTables())) return { ok: false, status: 503, error: "Invoices are not set up yet. Try again in a minute." };
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) return { ok: false, status: 404, error: "That booking no longer exists." };
  const problem = invoiceProblem(booking);
  if (problem) return { ok: false, status: 409, error: problem };

  const row = await issue(booking, now);
  const content = invoiceContent({
    booking,
    number: row.number,
    issuedOn: row.issued_on,
    email: (await guestEmailFor(booking.id)) ?? row.email_to,
  });
  const pdf = await renderInvoicePdf(content);
  return { ok: true, invoice: { content, pdf, filename: `Invoice-${row.number.replace(/\//g, "-")}.pdf` } };
}

/** Emails the invoice. `to` overrides the address on file (the owner may type one). */
export async function emailInvoice(
  bookingId: string,
  to: string | null,
  now = new Date(),
): Promise<{ ok: true; to: string } | { ok: false; status: number; error: string }> {
  const built = await buildInvoice(bookingId, now);
  if (!built.ok) return built;
  const address = to?.trim() || built.invoice.content.billedTo.email;
  if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return { ok: false, status: 400, error: "There is no email address for this guest. Type one, or download the PDF and send it on WhatsApp." };
  }
  const message = invoiceEmail(built.invoice.content);
  const sent = await sendEmail(address, message.subject, message.text, [
    { filename: built.invoice.filename, content: built.invoice.pdf, contentType: "application/pdf" },
  ]);
  if (!sent) {
    return { ok: false, status: 502, error: "The email could not be sent. Check that a mailbox is connected (Calendar page → Mailboxes)." };
  }
  await pool.query("UPDATE guest_invoices SET emailed_at = $2, email_to = $3 WHERE booking_id = $1", [bookingId, now, address]);
  logger.info({ bookingId, number: built.invoice.content.number }, "Invoice emailed");
  return { ok: true, to: address };
}

function addDays(isoDate: string, days: number): string {
  const at = new Date(`${isoDate}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

async function recentOwnStays(now: Date): Promise<Booking[]> {
  const today = istDateOf(now);
  return db
    .select()
    .from(bookings)
    .where(
      and(
        inArray(bookings.source, [...AUTO_EMAIL_SOURCES]),
        eq(bookings.status, "confirmed"),
        gte(bookings.checkOut, addDays(today, -SEND_WINDOW_DAYS)),
        lte(bookings.checkOut, today),
      ),
    );
}

let running = false;

/** Hourly: email the invoice for own stays that checked out, once, when fully paid. */
export async function runInvoiceEmails(now = new Date()): Promise<{ sent: number; waiting: number }> {
  const result = { sent: 0, waiting: 0 };
  if (running || !(await ensureInvoiceTables())) return result;
  running = true;
  try {
    for (const booking of await recentOwnStays(now)) {
      const row = await invoiceRow(booking.id);
      const email = await guestEmailFor(booking.id);
      const decision = autoEmailDecision({ booking, email, alreadyEmailed: Boolean(row?.emailed_at), now });
      if (!decision.send) {
        if (decision.kind === "waiting") result.waiting += 1;
        continue;
      }
      const sent = await emailInvoice(booking.id, email, now);
      if (sent.ok) result.sent += 1;
    }
    if (result.sent) logger.info(result, "Check-out invoices emailed");
    return result;
  } catch (error) {
    logger.error({ err: error }, "Invoice email run failed");
    return result;
  } finally {
    running = false;
  }
}

export type InvoiceStatus = {
  number: string | null;
  issuedOn: string | null;
  emailedAt: Date | null;
  emailTo: string | null;
  email: string | null;
  /** What the automatic email is doing for this stay, in words. */
  autoStatus: string;
  /** Something the owner can fix (record payment, add an email). */
  needsAction: boolean;
  canInvoice: boolean;
  problem: string | null;
  /** PDFs the OTA emailed for this booking — its voucher shows the taxes the guest paid. */
  otaDocuments: Array<Pick<OtaDocumentMeta, "id" | "kind" | "filename" | "createdAt">>;
};

/** Invoice state for the stays the console is showing. */
export async function invoiceStatuses(bookingIds: string[], now = new Date()): Promise<Record<string, InvoiceStatus>> {
  const out: Record<string, InvoiceStatus> = {};
  if (!bookingIds.length || !(await ensureInvoiceTables())) return out;
  const rows = await db.select().from(bookings).where(inArray(bookings.id, bookingIds));
  const { rows: invoices } = await pool.query<InvoiceRow>(
    "SELECT id, booking_id, number, to_char(issued_on, 'YYYY-MM-DD') AS issued_on, emailed_at, email_to FROM guest_invoices WHERE booking_id = ANY($1::uuid[])",
    [bookingIds],
  );
  const byBooking = new Map(invoices.map((row) => [row.booking_id, row]));
  const otaDocs = await documentsForRefs(rows.map((booking) => booking.externalRef ?? "").filter(Boolean));
  for (const booking of rows) {
    const invoice = byBooking.get(booking.id);
    const email = await guestEmailFor(booking.id);
    const decision = autoEmailDecision({ booking, email, alreadyEmailed: Boolean(invoice?.emailed_at), now });
    const problem = invoiceProblem(booking);
    out[booking.id] = {
      number: invoice?.number ?? null,
      issuedOn: invoice?.issued_on ?? null,
      emailedAt: invoice?.emailed_at ?? null,
      emailTo: invoice?.email_to ?? null,
      email,
      autoStatus: invoice?.emailed_at ? `Emailed to ${invoice.email_to}` : decision.send ? "Emails within the hour" : decision.reason,
      needsAction: !decision.send && decision.kind === "waiting",
      canInvoice: problem === null,
      problem,
      otaDocuments: (booking.externalRef ? otaDocs.get(booking.externalRef) ?? [] : []).map((doc) => ({
        id: doc.id,
        kind: doc.kind,
        filename: doc.filename,
        createdAt: doc.createdAt,
      })),
    };
  }
  return out;
}

let started = false;

export function startInvoiceEmails(): void {
  if (started) return;
  started = true;
  void ensureInvoiceTables();
  setTimeout(() => void runInvoiceEmails(), 2 * 60_000).unref?.();
  setInterval(() => void runInvoiceEmails(), 60 * 60_000).unref?.();
}
