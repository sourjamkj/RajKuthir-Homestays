import { and, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { bookings, db, enquiries, pool, type Booking } from "@workspace/db";

import { logger } from "./logger";
import { sendEmail } from "./book-pay-notify";
import QRCode from "qrcode";
import { renderInvoicePdf } from "./invoice-pdf";
import { upiIntentUrl } from "./book-pay-rules";
import { upiDetails } from "./whatsapp-templates";
import { documentsForRefs, type OtaDocumentMeta } from "./ota-documents";
import { createHash, randomBytes } from "node:crypto";
import { SITE_ORIGIN } from "./seo";
import { isWhatsappEnabled, sendTemplate, toWhatsappNumber, uploadMedia } from "./whatsapp-client";
import { paymentSourceForBooking, recordDelivery, recentUndelivered } from "./cashfree-repo";
import { methodLabel } from "./cashfree-rules";
import {
  advanceReceiptLine,
  deliverOnChannels,
  dueForRetry,
  type ConfirmationDelivery,
} from "./confirmation-delivery";
import {
  AUTO_EMAIL_SOURCES,
  SEND_WINDOW_DAYS,
  autoEmailDecision,
  financialYear,
  invoiceContent,
  invoiceEmail,
  invoiceNumber,
  invoiceProblem,
  invoiceWhatsappParams,
  confirmationEmail,
  invoiceWhatsappText,
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
ALTER TABLE guest_invoices ADD COLUMN IF NOT EXISTS whatsapp_sent_at timestamptz;
ALTER TABLE guest_invoices ADD COLUMN IF NOT EXISTS whatsapp_to      text;
ALTER TABLE guest_invoices ADD COLUMN IF NOT EXISTS share_token_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS guest_invoice_share_uniq ON guest_invoices (share_token_hash);
`;

const ROW_COLS =
  "id, booking_id, number, to_char(issued_on, 'YYYY-MM-DD') AS issued_on, emailed_at, email_to, whatsapp_sent_at, whatsapp_to";

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

type InvoiceRow = {
  id: string;
  booking_id: string | null;
  number: string;
  issued_on: string;
  emailed_at: Date | null;
  email_to: string | null;
  whatsapp_sent_at: Date | null;
  whatsapp_to: string | null;
};

async function invoiceRow(bookingId: string): Promise<InvoiceRow | null> {
  const { rows } = await pool.query<InvoiceRow>(
    `SELECT ${ROW_COLS} FROM guest_invoices WHERE booking_id = $1`,
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
      `SELECT ${ROW_COLS} FROM guest_invoices WHERE booking_id = $1`,
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
       RETURNING ${ROW_COLS}`,
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

/**
 * The booking confirmation: the same layout, titled BOOKING CONFIRMATION,
 * with the booking reference, advance received, the balance due at check-in
 * and — when there is a balance and a UPI ID is configured — a QR for it.
 * Not numbered and not an invoice; nothing is stored.
 */
export async function buildConfirmation(
  bookingId: string,
  now = new Date(),
): Promise<{ ok: true; invoice: BuiltInvoice } | { ok: false; status: number; error: string }> {
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) return { ok: false, status: 404, error: "That booking no longer exists." };
  const problem = invoiceProblem(booking);
  if (problem) return { ok: false, status: 409, error: problem };

  const reference = booking.reference ?? booking.externalRef ?? booking.id.slice(0, 8).toUpperCase();
  const content = invoiceContent({ booking, number: reference, issuedOn: istDateOf(now), email: await guestEmailFor(booking.id) });

  const upi = upiDetails();
  let payment = null;
  if (upi && content.balancePaise > 0) {
    const url = upiIntentUrl({ upiId: upi.id, payeeName: upi.name, amountPaise: content.balancePaise, note: reference });
    payment = {
      upiId: upi.id,
      payeeName: upi.name,
      note: reference,
      qrPng: new Uint8Array(await QRCode.toBuffer(url, { type: "png", errorCorrectionLevel: "M", margin: 1, width: 360 })),
    };
  }
  // How the advance came in: online through Cashfree, or a UPI transfer with a UTR.
  const source = await paymentSourceForBooking(booking.id);
  const receipt =
    content.paidPaise > 0
      ? advanceReceiptLine({
          online: source.online
            ? { method: methodLabel(source.online.paymentGroup), paidAt: source.online.paidAt, cfPaymentId: source.online.cfPaymentId }
            : null,
          utr: source.utr,
        })
      : null;
  const pdf = await renderInvoicePdf(content, { kind: "confirmation", payment, receipt });
  return { ok: true, invoice: { content, pdf, filename: `Booking-Confirmation-${reference.replace(/[^\w-]+/g, "-")}.pdf` } };
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

/* ------------------------------- WhatsApp ------------------------------- */

/**
 * Invoices go by WhatsApp — the PDF attached as the template's document
 * header — when the Cloud API is on and WHATSAPP_INVOICE_TEMPLATE names an
 * approved template with a Document header and two body params (first
 * name, invoice number).
 */
export function invoiceWhatsappReady(): boolean {
  return isWhatsappEnabled() && Boolean(process.env["WHATSAPP_INVOICE_TEMPLATE"]?.trim());
}

/** Sends the invoice PDF on WhatsApp through the Cloud API. */
export async function whatsappInvoice(
  bookingId: string,
  now = new Date(),
): Promise<{ ok: true; to: string } | { ok: false; status: number; error: string }> {
  if (!invoiceWhatsappReady()) {
    return { ok: false, status: 409, error: "WhatsApp sending is not set up (WHATSAPP_ENABLED and WHATSAPP_INVOICE_TEMPLATE)." };
  }
  const built = await buildInvoice(bookingId, now);
  if (!built.ok) return built;
  const to = toWhatsappNumber(built.invoice.content.billedTo.phone);
  if (!to) return { ok: false, status: 400, error: "There is no valid WhatsApp number on this booking." };

  const media = await uploadMedia({ bytes: built.invoice.pdf, mimeType: "application/pdf", filename: built.invoice.filename });
  if (!media.ok) return { ok: false, status: 502, error: `WhatsApp refused the PDF: ${media.error}` };

  const sent = await sendTemplate({
    to,
    templateName: process.env["WHATSAPP_INVOICE_TEMPLATE"]!.trim(),
    params: invoiceWhatsappParams(built.invoice.content),
    headerDocument: { mediaId: media.mediaId, filename: built.invoice.filename },
  });
  if (!sent.ok) return { ok: false, status: 502, error: `WhatsApp did not send it: ${sent.error}` };

  await pool.query("UPDATE guest_invoices SET whatsapp_sent_at = $2, whatsapp_to = $3 WHERE booking_id = $1", [bookingId, now, to]);
  logger.info({ bookingId, number: built.invoice.content.number }, "Invoice sent on WhatsApp");
  return { ok: true, to };
}

/**
 * Sends the booking confirmation PDF the moment a booking is confirmed, on
 * EVERY channel available — email (when the guest gave an address) AND
 * WhatsApp (when the Cloud API and WHATSAPP_CONFIRMATION_TEMPLATE are set
 * up) — independently, so one failing never stops the other. The PDF is
 * built once. The result is recorded in confirmation_deliveries, and a
 * failed send is retried by the Book & Pay cron. Never throws: a failed send
 * must not undo a booking; the console's Confirmation button remains.
 *
 * `emailMessage` replaces the standard confirmation email text (Book & Pay
 * sends its own, with the pre-arrival link).
 */
export async function deliverConfirmation(
  bookingId: string,
  options: { emailMessage?: { subject: string; text: string }; paymentRequestId?: string | null } = {},
  now = new Date(),
): Promise<ConfirmationDelivery & { built: BuiltInvoice | null }> {
  try {
    const built = await buildConfirmation(bookingId, now);
    if (!built.ok) {
      return { email: "skipped", whatsapp: "skipped", emailTo: null, whatsappTo: null, notes: [built.error], built: null };
    }
    const { content, pdf, filename } = built.invoice;
    const attachment = { filename, content: pdf, contentType: "application/pdf" };
    const message = options.emailMessage ?? confirmationEmail(content);
    const template = process.env["WHATSAPP_CONFIRMATION_TEMPLATE"]?.trim();

    const result = await deliverOnChannels(content.billedTo.email, {
      sendEmail: (to) => sendEmail(to, message.subject, message.text, [attachment]),
      whatsapp:
        isWhatsappEnabled() && template
          ? {
              to: toWhatsappNumber(content.billedTo.phone),
              send: async (to) => {
                const media = await uploadMedia({ bytes: pdf, mimeType: "application/pdf", filename });
                if (!media.ok) return { ok: false, error: `PDF upload refused: ${media.error}` };
                const sent = await sendTemplate({
                  to,
                  templateName: template,
                  params: [content.billedTo.name.split(/\s+/)[0] || "there", content.number],
                  headerDocument: { mediaId: media.mediaId, filename },
                });
                return sent.ok ? { ok: true } : { ok: false, error: sent.error };
              },
            }
          : null,
    });

    const paymentRequestId = options.paymentRequestId ?? (await paymentSourceForBooking(bookingId)).paymentRequestId;
    await recordDelivery(bookingId, paymentRequestId, result, now);
    logger.info({ bookingId, email: result.email, whatsapp: result.whatsapp }, "Booking confirmation delivered");
    return { ...result, built: built.invoice };
  } catch (error) {
    logger.error({ err: error, bookingId }, "Sending the booking confirmation failed");
    return { email: "failed", whatsapp: "failed", emailTo: null, whatsappTo: null, notes: ["Could not send the confirmation."], built: null };
  }
}

/** The older single-answer shape, for the enquiry routes. Sends on every channel. */
export async function sendConfirmation(
  bookingId: string,
  now = new Date(),
): Promise<{ via: "email" | "whatsapp" | null; to: string | null; note: string | null }> {
  const result = await deliverConfirmation(bookingId, {}, now);
  if (result.email === "sent") return { via: "email", to: result.emailTo, note: result.whatsapp === "sent" ? "Also sent on WhatsApp." : null };
  if (result.whatsapp === "sent") return { via: "whatsapp", to: result.whatsappTo, note: null };
  return { via: null, to: null, note: "Not sent automatically — use Share on the Confirmation PDF in Guests." };
}

/**
 * Retries confirmations that reached nobody because a channel FAILED (not
 * merely skipped), a few minutes apart, for half an hour. Called by the
 * Book & Pay cron. Never throws.
 */
export async function retryConfirmations(now = new Date()): Promise<number> {
  let retried = 0;
  for (const row of await recentUndelivered(now)) {
    if (!dueForRetry(row, now)) continue;
    const result = await deliverConfirmation(row.bookingId, { paymentRequestId: row.paymentRequestId }, now);
    retried += 1;
    logger.info({ bookingId: row.bookingId, email: result.email, whatsapp: result.whatsapp }, "Retried a booking confirmation");
  }
  return retried;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * The manual path, when the Cloud API is not set up: a private link to the
 * PDF (token in the URL fragment, never in a server log) inside a message
 * the owner sends from their own WhatsApp. A new link replaces the old one.
 */
export async function invoiceShareMessage(
  bookingId: string,
  now = new Date(),
): Promise<{ ok: true; whatsappUrl: string | null; text: string } | { ok: false; status: number; error: string }> {
  const built = await buildInvoice(bookingId, now);
  if (!built.ok) return built;
  const token = randomBytes(24).toString("base64url");
  await pool.query("UPDATE guest_invoices SET share_token_hash = $2 WHERE booking_id = $1", [bookingId, hashToken(token)]);
  const text = invoiceWhatsappText(built.invoice.content, `${SITE_ORIGIN}/invoice#${token}`);
  const to = toWhatsappNumber(built.invoice.content.billedTo.phone);
  return { ok: true, text, whatsappUrl: to ? `https://wa.me/${to}?text=${encodeURIComponent(text)}` : null };
}

/** The guest's side of the private link. */
export async function invoiceByToken(token: string): Promise<BuiltInvoice | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token) || !(await ensureInvoiceTables())) return null;
  const { rows } = await pool.query<{ booking_id: string | null }>(
    "SELECT booking_id FROM guest_invoices WHERE share_token_hash = $1",
    [hashToken(token)],
  );
  const bookingId = rows[0]?.booking_id;
  if (!bookingId) return null;
  const built = await buildInvoice(bookingId);
  return built.ok ? built.invoice : null;
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

/**
 * Hourly: send the invoice for own stays that checked out, once, when fully
 * paid — by email, or by WhatsApp when there is no email and it is set up.
 */
export async function runInvoiceEmails(now = new Date()): Promise<{ sent: number; waiting: number }> {
  const result = { sent: 0, waiting: 0 };
  if (running || !(await ensureInvoiceTables())) return result;
  running = true;
  try {
    for (const booking of await recentOwnStays(now)) {
      const row = await invoiceRow(booking.id);
      const email = await guestEmailFor(booking.id);
      const decision = autoEmailDecision({
        booking,
        email,
        alreadyEmailed: Boolean(row?.emailed_at || row?.whatsapp_sent_at),
        whatsappTo: invoiceWhatsappReady() ? toWhatsappNumber(booking.guestPhone) : null,
        now,
      });
      if (!decision.send) {
        if (decision.kind === "waiting") result.waiting += 1;
        continue;
      }
      const sent =
        decision.channel === "email" ? await emailInvoice(booking.id, email, now) : await whatsappInvoice(booking.id, now);
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
  /** Invoices can be sent through the WhatsApp Cloud API (else the WhatsApp button prepares a message). */
  whatsappReady: boolean;
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
    `SELECT ${ROW_COLS} FROM guest_invoices WHERE booking_id = ANY($1::uuid[])`,
    [bookingIds],
  );
  const byBooking = new Map(invoices.map((row) => [row.booking_id, row]));
  const otaDocs = await documentsForRefs(rows.map((booking) => booking.externalRef ?? "").filter(Boolean));
  for (const booking of rows) {
    const invoice = byBooking.get(booking.id);
    const email = await guestEmailFor(booking.id);
    const decision = autoEmailDecision({
      booking,
      email,
      alreadyEmailed: Boolean(invoice?.emailed_at || invoice?.whatsapp_sent_at),
      whatsappTo: invoiceWhatsappReady() ? toWhatsappNumber(booking.guestPhone) : null,
      now,
    });
    const problem = invoiceProblem(booking);
    out[booking.id] = {
      number: invoice?.number ?? null,
      issuedOn: invoice?.issued_on ?? null,
      emailedAt: invoice?.emailed_at ?? null,
      emailTo: invoice?.email_to ?? null,
      email,
      autoStatus: invoice?.emailed_at
        ? `Emailed to ${invoice.email_to}`
        : invoice?.whatsapp_sent_at
          ? `Sent on WhatsApp to +${invoice.whatsapp_to}`
          : decision.send
            ? decision.channel === "email"
              ? "Emails within the hour"
              : "Goes on WhatsApp within the hour"
            : decision.reason,
      whatsappReady: invoiceWhatsappReady(),
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
