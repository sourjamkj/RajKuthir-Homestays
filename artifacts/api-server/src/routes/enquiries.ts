import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/admin-auth";
import { logger } from "../lib/logger";
import { normaliseMobile } from "../lib/phone";
import {
  createEnquiry,
  deleteEnquiry,
  getEnquiry,
  listContacts,
  listEnquiries,
  clearQuoteSent,
  markQuoteSent,
  setAdvancePaid,
  setEnquiryStatus,
  updateContact,
  type EnquiryStatus,
  setBookingDetails,
  updateEnquiryFields,
} from "../lib/enquiries-repo";
import { enquiryViews } from "../lib/enquiry-view";
import { bookEnquiryWithDetails, sendEnquiryQuote } from "../lib/enquiry-actions";
import { saveTerms, termsOf } from "../lib/enquiry-terms";
import { datesProblem, parseEnquiryEdit, termsProblem, type EnquiryTerms } from "../lib/enquiry-terms-rules";
import { convertEnquiry } from "../lib/enquiry-convert-service";
import { sendConfirmation } from "../lib/invoices";
import { findByEnquiryId } from "../lib/book-pay-repo";
import { holdExpiryOf, holdStateOf } from "../lib/enquiry-hold";
import { firstConflict } from "../lib/availability";
import { listAllEvents, listPublicBlocks } from "../lib/calendar-repo";
import { datesTakenFor } from "../lib/enquiry-clash";
import {
  buildEnquiryQuoteTemplate,
  upiDetails,
} from "../lib/whatsapp-templates";
import { sendTemplate, toWhatsappNumber } from "../lib/whatsapp-client";
import { guestApiSendingOn } from "../lib/whatsapp-mode";

const router: IRouter = Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const STATUSES: readonly EnquiryStatus[] = [
  "new",
  "contacted",
  "converted",
  "closed",
];

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function text(value: unknown, max: number): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw.slice(0, max) : null;
}

/** The terms keys only, so the create form's base fields are read as before. */
function pickTerms(body: unknown): Record<string, unknown> {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ["childrenAges", "ownerNote", "priceNote", "agreedTotalRupees", "agreedAdvanceRupees"]) {
    if (Object.prototype.hasOwnProperty.call(b, key)) out[key] = b[key];
  }
  return out;
}

const NO_TERMS_COPY = (): EnquiryTerms => ({ childrenAges: null, ownerNote: null, agreedTotalPaise: null, agreedAdvancePaise: null, priceNote: null });

function count(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) return null;
  return parsed;
}

/**
 * Simple per-IP throttle on the public enquiry endpoint. This is the only
 * unauthenticated write in the app, so it is the only thing standing between
 * a bored script and a few thousand junk rows in the owner's lead list.
 */
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function tooMany(key: string, now = Date.now()): boolean {
  const entry = attempts.get(key);

  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });

    if (attempts.size > 1000) {
      for (const [candidate, value] of attempts) {
        if (value.resetAt <= now) attempts.delete(candidate);
      }
    }

    return false;
  }

  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

/** Public: the guest enquiry form posts here. */
/**
 * Public enquiries are switched off (the owner's decision, November 2026):
 * the website's form books (hold the dates, pay the advance), and anything it
 * cannot book goes to the host on WhatsApp. An old cached page, or anything
 * else still posting here, gets a clear refusal instead of filing an enquiry.
 *
 * The handler below is kept intact so turning enquiries back on is deleting
 * this guard. The owner's own hand entry (POST /admin/enquiries) is unaffected.
 */
const PUBLIC_ENQUIRIES_OPEN = false;

router.post("/enquiries", async (req, res) => {
  if (!PUBLIC_ENQUIRIES_OPEN) {
    res.status(410).json({
      error:
        "We no longer take enquiries here. Choose your dates on the calendar to hold them and pay the advance, or message us on WhatsApp on +91 62903 99165.",
    });
    return;
  }

  if (tooMany(req.ip ?? "unknown")) {
    res.status(429).json({
      error: "Too many enquiries from this connection. Please try again later.",
    });
    return;
  }

  const name = text(req.body?.name, 200);
  const phone = text(req.body?.phone, 40);

  if (!name || !phone) {
    res.status(400).json({ error: "Please include a name and phone number." });
    return;
  }

  const dialable = normaliseMobile(phone);

  if (!dialable) {
    res.status(400).json({
      error: "That does not look like a mobile number we can call back.",
    });
    return;
  }

  const checkIn = text(req.body?.checkIn, 10);
  const checkOut = text(req.body?.checkOut, 10);

  const wantsDates =
    checkIn && checkOut && ISO_DATE.test(checkIn) && ISO_DATE.test(checkOut);

  /*
    Turn away an enquiry for dates that are already taken, before it is stored.

    Better here than in the owner's inbox: the guest finds out while they are
    still on the page and can pick other dates, rather than waiting a day for
    a reply that says no. The same merged ranges the public availability feed
    publishes, so the form and the calendar can never disagree.

    Provisional holds are deliberately not in this set — an advance that has
    not arrived should not stop somebody else asking.
  */
  if (wantsDates) {
    const conflict = firstConflict(
      { startDate: checkIn, endDate: checkOut },
      await listPublicBlocks(),
    );

    if (conflict) {
      res.status(409).json({
        error:
          "Those dates are already taken. Please check the calendar and try different dates — we would still love to have you.",
        conflict,
      });
      return;
    }
  }

  try {
    const created = await createEnquiry({
      name,
      phone: dialable,
      email: text(req.body?.email, 200),
      checkIn: checkIn && ISO_DATE.test(checkIn) ? checkIn : null,
      checkOut: checkOut && ISO_DATE.test(checkOut) ? checkOut : null,
      adults: count(req.body?.adults),
      children: count(req.body?.children),
      pets: count(req.body?.pets),
      requests: text(req.body?.requests, 1000),
    });

    logger.info({ enquiryId: created.id }, "Enquiry received");
    res.status(201).json({ received: true });
  } catch (error) {
    logger.error({ err: error }, "Could not save enquiry");
    // The guest has done nothing wrong; do not surface our storage problem.
    res.status(201).json({ received: true });
  }
});

/**
 * Admin: add a lead by hand — a phone call, a walk-in ask, a contact from
 * somewhere the automated capture doesn't reach.
 *
 * Deliberately thin: only name and phone are required, same as the public
 * form, so this is fast to use while standing at the desk. It reuses
 * createEnquiry rather than the booking path — a hand-entered lead is a lead,
 * not a confirmed stay, and it shows up in the enquiries list to be quoted,
 * followed up, or converted the normal way. No IP throttle: this is an
 * authenticated owner action, not the open internet.
 */
router.post("/admin/enquiries", requireAdmin, async (req, res) => {
  const name = text(req.body?.name, 200);
  const phone = text(req.body?.phone, 40);

  if (!name || !phone) {
    res.status(400).json({ error: "Name and phone number are required." });
    return;
  }

  const dialable = normaliseMobile(phone);

  if (!dialable) {
    res.status(400).json({ error: "That does not look like a mobile number we can reach." });
    return;
  }

  const checkIn = text(req.body?.checkIn, 10);
  const checkOut = text(req.body?.checkOut, 10);

  // The owner's extra details (children's ages, a note, the agreed price),
  // read the same way as an edit so both forms accept the same fields.
  const extra = parseEnquiryEdit(pickTerms(req.body), normaliseMobile);
  if (!extra.ok) {
    res.status(400).json({ error: extra.error });
    return;
  }
  const newTerms: EnquiryTerms = { ...NO_TERMS_COPY(), ...extra.terms };
  const termsError = termsProblem(newTerms) ?? datesProblem(checkIn, checkOut);
  if (termsError) {
    res.status(400).json({ error: termsError });
    return;
  }

  try {
    const created = await createEnquiry({
      name,
      phone: dialable,
      email: text(req.body?.email, 200),
      checkIn: checkIn && ISO_DATE.test(checkIn) ? checkIn : null,
      checkOut: checkOut && ISO_DATE.test(checkOut) ? checkOut : null,
      adults: count(req.body?.adults),
      children: count(req.body?.children),
      pets: count(req.body?.pets),
      requests: text(req.body?.requests, 1000),
    });

    if (Object.values(newTerms).some((v) => v !== null)) await saveTerms(created.id, newTerms);
    const clash = datesTakenFor(created, await listAllEvents().catch(() => []));
    res.status(201).json({ id: created.id, datesTaken: clash });
  } catch (error) {
    logger.error({ err: error }, "Could not save hand-entered enquiry");
    res.status(500).json({ error: "Could not save this enquiry. Please try again." });
  }
});

/**
 * Every enquiry, each with the price it would be quoted at today.
 *
 * The quote is attached here rather than fetched per row so the owner sees
 * the number before deciding to send it, and so an enquiry that cannot be
 * priced says why on the card instead of failing at the moment of sending.
 * One rate plan is read for the whole list; the pricing itself is pure.
 */
router.get("/enquiries", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const rows = await listEnquiries();

  res.json({
    enquiries: await enquiryViews(rows),
    /*
      The screen disables the send button and explains itself rather than
      offering an action that cannot work.

      WhatsApp configuration is deliberately NOT part of this any more. Without
      it the quote goes out as a wa.me link from the owner's own WhatsApp,
      which works perfectly well — gating on the Business API meant the button
      stayed dead while waiting for an account that had not been approved yet.

      UPI is still required: a quote with no payment details to pay into is not
      a quote, and there is nothing sensible to put in the message.
    */
    quotingReady: upiDetails() !== null,
    /** How a quote would go out right now, so the screen can say so. */
    quoteDelivery: guestApiSendingOn() ? "api" : "manual_whatsapp",
  });
});

/**
 * Sends the guest their quote and the UPI details to confirm with.
 *
 * Owner-initiated on purpose. The enquiry form is open to the whole internet,
 * and auto-replying would put the owner's payment handle in front of every
 * bot that fills it in.
 *
 * The order matters: price it, send it, and only then record it. Recording
 * first would mark an enquiry as quoted when the guest never received
 * anything, and the owner would stop chasing a booking that was never made.
 */
router.post("/enquiries/:id/quote", requireAdmin, async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;

  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid enquiry id." });
    return;
  }

  const result = await sendEnquiryQuote(id);
  if (!result.ok) {
    res.status(result.status).json(result.body);
    return;
  }
  res.json(result.body);
});

/**
 * Turns a won enquiry into a booking — the step that used to be re-typing.
 *
 * Everything downstream hangs off the bookings row this creates: the RK-
 * reference is issued here, and with it the arrival pack at /welcome and the
 * guest verification flow, both of which key off the booking.
 *
 * Deliberately NOT automatic on payment. The owner marks the advance received
 * by looking at a screenshot, and turning that into a calendar entry is a
 * second judgement — the dates may have gone in the meantime, or the guest may
 * have asked to move them in the same message.
 */
router.post("/enquiries/:id/convert", requireAdmin, async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;

  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid enquiry id." });
    return;
  }

  const enquiry = await getEnquiry(id);

  if (!enquiry) {
    res.status(404).json({ error: "That enquiry no longer exists." });
    return;
  }

  // A Book & Pay enquiry already has its RK- reference: it went to the guest
  // as the UPI transaction note, so the booking must keep it.
  const paymentRequest = await findByEnquiryId(id);
  const outcome = await convertEnquiry(enquiry, { reference: paymentRequest?.reference ?? null });

  if (!outcome.ok) {
    const { ok: _ok, status, ...body } = outcome;
    res.status(status).json(body);
    return;
  }

  // The guest gets the booking confirmation PDF (payment summary + UPI QR)
  // right away: by email, or by WhatsApp when that is set up.
  const confirmation = outcome.booking.status === "confirmed" ? await sendConfirmation(outcome.booking.id) : null;
  logger.info(
    { enquiryId: id, bookingId: outcome.booking.id, confirmationSent: confirmation?.via ?? null },
    "Booking confirmation handled",
  );

  res.status(201).json({
    booking: {
      id: outcome.booking.id,
      reference: outcome.booking.reference,
      status: outcome.booking.status,
      checkIn: outcome.booking.checkIn,
      checkOut: outcome.booking.checkOut,
    },
    enquiry: outcome.enquiry,
    confirmation,
  });
});

/**
 * "Book with my details": the owner fills in what the enquiry lacks — dates,
 * party, the agreed total and the advance received — and it becomes a booking
 * in one step, through the same conversion (and duplicate rules) as Create
 * booking. Prices here are the owner's own deal, not the rate card's.
 */
router.post("/enquiries/:id/book", requireAdmin, async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;
  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid enquiry id." });
    return;
  }
  const result = await bookEnquiryWithDetails(id, (req.body ?? {}) as Record<string, unknown>);
  res.status(result.ok ? 201 : result.status).json(result.body);
});

/**
 * Undoes a quote that was recorded but never actually sent.
 *
 * Only reachable for the manual WhatsApp path in practice, and the reason that
 * path can be one click instead of two.
 */
router.delete("/enquiries/:id/quote", requireAdmin, async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;

  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid enquiry id." });
    return;
  }

  const updated = await clearQuoteSent(id);

  if (!updated) {
    res.status(404).json({ error: "That enquiry no longer exists." });
    return;
  }

  logger.info({ enquiryId: id }, "Enquiry quote withdrawn");

  res.json({ enquiry: updated, hold: holdStateOf(updated, new Date()) });
});

/**
 * Records that the advance arrived — which is what stops these dates being
 * released when the 24 hours are up.
 *
 * Deliberately a human decision rather than anything automatic: the money
 * lands in a bank account this server cannot see, so somebody has to look at
 * the screenshot. Reversible, because somebody will click the wrong row.
 */
router.post("/enquiries/:id/advance-received", requireAdmin, async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;

  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid enquiry id." });
    return;
  }

  const paid = req.body?.paid !== false;
  const updated = await setAdvancePaid(id, paid);

  if (!updated) {
    res.status(404).json({ error: "That enquiry no longer exists." });
    return;
  }

  logger.info({ enquiryId: id, paid }, "Advance payment mark changed");

  res.json({ enquiry: updated, hold: holdStateOf(updated, new Date()) });
});

/**
 * Changes an enquiry: its status, and/or the details the owner corrects or
 * adds (name, phone, dates, adults, children with their ages, pets, the
 * guest's requests, a private note, the agreed price). Only the keys sent
 * change; an empty value clears an optional field.
 */
router.patch("/enquiries/:id", requireAdmin, async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;

  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid enquiry id." });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const existing = await getEnquiry(id);
  if (!existing) {
    res.status(404).json({ error: "That enquiry no longer exists." });
    return;
  }

  let status: EnquiryStatus | null = null;
  if (body.status !== undefined) {
    status = String(body.status) as EnquiryStatus;
    if (!STATUSES.includes(status)) {
      res.status(400).json({ error: "Choose a valid status." });
      return;
    }
  }

  const edit = parseEnquiryEdit(body, normaliseMobile);
  if (!edit.ok) {
    res.status(400).json({ error: edit.error });
    return;
  }
  const checkIn = edit.fields.checkIn !== undefined ? edit.fields.checkIn : existing.checkIn;
  const checkOut = edit.fields.checkOut !== undefined ? edit.fields.checkOut : existing.checkOut;
  const terms: EnquiryTerms = { ...(await termsOf(id)), ...edit.terms };
  const problem = datesProblem(checkIn, checkOut) ?? termsProblem(terms);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  try {
    let updated = await updateEnquiryFields(id, edit.fields);
    if (Object.keys(edit.terms).length > 0) await saveTerms(id, terms);
    if (status) updated = await setEnquiryStatus(id, status);
    if (!updated) {
      res.status(404).json({ error: "That enquiry no longer exists." });
      return;
    }
    const [view] = await enquiryViews([updated]);
    res.json(view);
  } catch (error) {
    logger.error({ err: error, enquiryId: id }, "Could not update enquiry");
    res.status(500).json({ error: error instanceof Error && error.message.startsWith("Could not") ? error.message : "Could not save the changes. Please try again." });
  }
});

router.delete("/enquiries/:id", requireAdmin, async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;

  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid enquiry id." });
    return;
  }

  const removed = await deleteEnquiry(id);

  if (!removed) {
    res.status(404).json({ error: "That enquiry no longer exists." });
    return;
  }

  res.status(204).end();
});

/**
 * The guest contact list for follow-ups and marketing. Admin-only: this is
 * the most personal data in the system.
 */
router.get("/contacts", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ contacts: await listContacts() });
});

router.patch("/contacts/:phone", requireAdmin, async (req, res) => {
  const phone = Array.isArray(req.params.phone) ? "" : req.params.phone;

  if (!/^\d{6,15}$/.test(phone)) {
    res.status(400).json({ error: "Invalid contact." });
    return;
  }

  const body = req.body ?? {};
  const patch: {
    marketingOptOut?: boolean;
    note?: string | null;
    tags?: string | null;
  } = {};

  if (body.marketingOptOut !== undefined) {
    patch.marketingOptOut = body.marketingOptOut === true;
  }
  if (body.note !== undefined) patch.note = text(body.note, 500);
  if (body.tags !== undefined) patch.tags = text(body.tags, 200);

  await updateContact(phone, patch);
  res.json({ saved: true });
});

export default router;
