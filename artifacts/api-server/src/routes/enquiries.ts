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
  markQuoteSent,
  setAdvancePaid,
  setEnquiryStatus,
  updateContact,
  type EnquiryStatus,
} from "../lib/enquiries-repo";
import { quoteForEnquiry, type QuoteResult } from "../lib/enquiry-quote";
import { holdExpiryOf, holdStateOf } from "../lib/enquiry-hold";
import { firstConflict } from "../lib/availability";
import { listPublicBlocks } from "../lib/calendar-repo";
import { getRatePlan, rateForNight } from "../lib/rates-repo";
import {
  buildEnquiryQuoteTemplate,
  upiDetails,
} from "../lib/whatsapp-templates";
import { isWhatsappEnabled, sendTemplate, toWhatsappNumber } from "../lib/whatsapp-client";

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
router.post("/enquiries", async (req, res) => {
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
  const plan = await getRatePlan();

  const nightlyRate = (isoDate: string, guests: number) =>
    rateForNight(plan, isoDate, guests);

  // One clock for the whole list, so two rows quoted in the same second can
  // never disagree about how long they have left.
  const now = new Date();

  res.json({
    enquiries: rows.map((row) => ({
      ...row,
      quote: quoteForEnquiry(row, nightlyRate),
      hold: holdStateOf(row, now),
    })),
    // The screen disables the send button and explains itself rather than
    // offering an action that cannot work.
    quotingReady: isWhatsappEnabled() && upiDetails() !== null,
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

  const enquiry = await getEnquiry(id);

  if (!enquiry) {
    res.status(404).json({ error: "That enquiry no longer exists." });
    return;
  }

  const upi = upiDetails();

  if (!upi) {
    res.status(503).json({
      error:
        "RAJ_KUTHIR_UPI_ID and RAJ_KUTHIR_UPI_NAME are not set on the server, so there are no payment details to send.",
    });
    return;
  }

  const to = toWhatsappNumber(enquiry.phone);

  if (!to) {
    res.status(422).json({
      error: "That phone number cannot be used for WhatsApp.",
    });
    return;
  }

  const plan = await getRatePlan();
  const quote: QuoteResult = quoteForEnquiry(enquiry, (isoDate, guests) =>
    rateForNight(plan, isoDate, guests),
  );

  if (!quote.ok) {
    res.status(422).json({ error: quote.reason });
    return;
  }

  // The deadline the guest is told is measured from this moment, and the
  // hold shown on the screen is measured from the quoteSentAt written below.
  // Same instant, so the message and the dashboard cannot drift apart.
  const sentAt = new Date();

  const template = buildEnquiryQuoteTemplate({
    guestName: enquiry.name,
    quote,
    upi,
    holdExpiresAt: holdExpiryOf(sentAt),
  });

  const sent = await sendTemplate({
    to,
    templateName: template.name,
    languageCode: template.languageCode,
    params: template.params,
  });

  if (!sent.ok) {
    logger.error(
      { enquiryId: id, error: sent.error, retryable: sent.retryable },
      "Could not send the enquiry quote",
    );
    res.status(502).json({ error: sent.error });
    return;
  }

  const updated = await markQuoteSent(
    id,
    { totalPaise: quote.totalPaise, advancePaise: quote.advancePaise },
    sentAt,
  );

  // No phone number and no payment handle in this line — it is a log, and
  // logs get shipped, read and kept.
  logger.info(
    { enquiryId: id, nights: quote.nights, guests: quote.guests },
    "Enquiry quote sent",
  );

  res.json({ enquiry: updated, quote, preview: template.preview });
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

router.patch("/enquiries/:id", requireAdmin, async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;

  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid enquiry id." });
    return;
  }

  const status = String(req.body?.status ?? "") as EnquiryStatus;

  if (!STATUSES.includes(status)) {
    res.status(400).json({ error: "Choose a valid status." });
    return;
  }

  const updated = await setEnquiryStatus(id, status);

  if (!updated) {
    res.status(404).json({ error: "That enquiry no longer exists." });
    return;
  }

  res.json(updated);
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
