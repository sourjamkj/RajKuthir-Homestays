import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/admin-auth";
import { logger } from "../lib/logger";
import { normaliseMobile } from "../lib/phone";
import {
  createEnquiry,
  deleteEnquiry,
  getEnquiry,
  linkEnquiryToBooking,
  listContacts,
  listEnquiries,
  clearQuoteSent,
  markQuoteSent,
  setAdvancePaid,
  setEnquiryStatus,
  updateContact,
  type EnquiryStatus,
} from "../lib/enquiries-repo";
import {
  CONVERSION_MESSAGES,
  draftBookingFromEnquiry,
} from "../lib/enquiry-conversion";
import { createBooking, findClashes } from "../lib/ledger-repo";
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

    res.status(201).json({ id: created.id });
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
    quoteDelivery: isWhatsappEnabled() ? "api" : "manual_whatsapp",
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

  /*
    Two ways out of here, and the difference is honest in the response.

    With WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN set, the message
    goes through Meta's API and the server knows it was accepted.

    Without them — which is the state this property is in today — the send used
    to fail and this endpoint answered 502, so the quote was never recorded and
    the hold never started. The whole feature was unusable while waiting for a
    Business API account. So the fallback returns the composed message and a
    wa.me link for the owner to send from their own WhatsApp, exactly as the
    guest onboarding handoff already does.

    `delivery` says which happened. It is never "sent" for the manual path,
    because opening WhatsApp is not delivering a message and this server has no
    way to learn whether the owner pressed send.
  */
  const auto = isWhatsappEnabled()
    ? await sendTemplate({
        to,
        templateName: template.name,
        languageCode: template.languageCode,
        params: template.params,
      })
    : null;

  if (auto && !auto.ok) {
    logger.error(
      { enquiryId: id, error: auto.error, retryable: auto.retryable },
      "Could not send the enquiry quote",
    );
    res.status(502).json({ error: auto.error });
    return;
  }

  /*
    The quote is recorded either way, because the 24-hour hold is measured from
    quoteSentAt and dates that are not held are dates that get double-sold.

    On the manual path that is optimistic: the owner might open WhatsApp and
    wander off. That is why DELETE /enquiries/:id/quote exists — the mistake is
    one click to undo, which is the price of not making every quote two clicks
    to send.
  */
  const updated = await markQuoteSent(
    id,
    { totalPaise: quote.totalPaise, advancePaise: quote.advancePaise },
    sentAt,
  );

  // No phone number and no payment handle in this line — it is a log, and
  // logs get shipped, read and kept.
  logger.info(
    { enquiryId: id, nights: quote.nights, guests: quote.guests, delivery: auto ? "api" : "manual_whatsapp" },
    auto ? "Enquiry quote sent" : "Enquiry quote prepared for manual WhatsApp send",
  );

  res.json({
    enquiry: updated,
    quote,
    preview: template.preview,
    delivery: auto ? "api" : "manual_whatsapp",
    // Only on the manual path, and only ever used to open WhatsApp.
    whatsappUrl: auto
      ? null
      : `https://wa.me/${to}?text=${encodeURIComponent(template.preview)}`,
  });
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

  const drafted = draftBookingFromEnquiry(enquiry);

  if (!drafted.ok) {
    // 409 for the one that is a state problem rather than a data problem:
    // the caller asked for something that has already happened.
    const status = drafted.reason === "already_converted" ? 409 : 422;
    res.status(status).json({
      error: CONVERSION_MESSAGES[drafted.reason],
      reason: drafted.reason,
      ...(drafted.reason === "already_converted"
        ? { bookingId: enquiry.convertedBookingId }
        : {}),
    });
    return;
  }

  /*
    Re-check the dates NOW, not as they were when the enquiry arrived.

    An enquiry can sit for days between the form and the advance landing, and
    an OTA booking may have taken the same nights in between. findClashes only
    counts confirmed bookings, so a pending row does not stand in the way.
  */
  const clashes = await findClashes({
    checkIn: drafted.draft.checkIn,
    checkOut: drafted.draft.checkOut,
    guestName: drafted.draft.guestName,
  });

  if (clashes.length > 0) {
    const clash = clashes[0]!;
    logger.warn(
      { enquiryId: id, kind: clash.kind, bookingId: clash.booking.id },
      "Refused to convert an enquiry over existing dates",
    );
    res.status(409).json({
      error:
        clash.kind === "duplicate"
          ? "There is already a booking for this guest on these exact dates."
          : `Those dates now clash with an existing booking (${clash.booking.checkIn} to ${clash.booking.checkOut}). Move the dates or cancel the other booking first.`,
      reason: clash.kind,
      clashes: clashes.map((item) => ({
        id: item.booking.id,
        kind: item.kind,
        reference: item.booking.reference,
        checkIn: item.booking.checkIn,
        checkOut: item.booking.checkOut,
      })),
    });
    return;
  }

  // createBooking issues the RK- reference, retrying on the astronomically
  // unlikely collision.
  const booking = await createBooking(drafted.draft);

  const updated = await linkEnquiryToBooking(id, booking.id);

  // No guest name or phone in this line — it is a log, and logs get shipped,
  // read and kept.
  logger.info(
    { enquiryId: id, bookingId: booking.id, status: booking.status },
    "Enquiry converted to a booking",
  );

  res.status(201).json({
    booking: {
      id: booking.id,
      reference: booking.reference,
      status: booking.status,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
    },
    enquiry: updated,
  });
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
