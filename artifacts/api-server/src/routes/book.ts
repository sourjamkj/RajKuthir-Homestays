import { Router, type IRouter, type Request } from "express";
import QRCode from "qrcode";
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { calendarEvents, db } from "@workspace/db";

import { requireAdmin } from "../lib/admin-auth";
import { logger } from "../lib/logger";
import { normaliseMobile } from "../lib/phone";
import { createLimiter } from "../lib/rate-limit";
import { quoteForEnquiry, nightsOf, type QuoteResult } from "../lib/enquiry-quote";
import { getRatePlan, minimumStay, rateForNight, stayNightPrices, type RatePlan } from "../lib/rates-repo";
import { isWeekendNight, peakFor } from "../lib/pricing";
import { upiDetails } from "../lib/whatsapp-templates";
import { getEnquiry, setAdvancePaid, setEnquiryStatus } from "../lib/enquiries-repo";
import { convertEnquiry } from "../lib/enquiry-convert-service";
import { createOrRefreshOnboarding } from "../lib/guest-onboarding-repo";
import { SITE_ORIGIN } from "../lib/seo";
import {
  checkScreenshot,
  clashesWith,
  guestStatusText,
  holdBlocks,
  looksLikePayToken,
  nextFreeWindows,
  normaliseUtr,
  secondsLeft,
  settingsProblem,
  upiIntentUrl,
  type BookPaySettings,
} from "../lib/book-pay-rules";
import { startHold, type StartInput } from "../lib/book-pay-start";
import {
  findById,
  findByToken,
  getBookPaySettings,
  getScreenshot,
  isNotMigrated,
  listForAdmin,
  logPaymentEvent,
  markExpiryNotified,
  pgStartStore,
  readTakenRanges,
  saveBookPaySettings,
  setDecision,
  submitUtr,
} from "../lib/book-pay-repo";
import { confirmedMessage, expiredMessage, ownerUtrAlert } from "../lib/book-pay-messages";
import { ownerEmail, sendEmail, sendWhatsappTemplate } from "../lib/book-pay-notify";

/**
 * Self-serve Book & Pay by UPI, on top of the existing enquiry pipeline:
 *
 *   /book/quote  price + availability          (public, rate-limited)
 *   /book/start  enquiry + quote + hold         (public, rate-limited)
 *   /book/pay    the guest's payment page data  (bearer token)
 *   /book/pay/utr  "I have paid", with UTR      (bearer token)
 *   /admin/book-pay…  verify, confirm, reject   (owner only)
 *
 * Every amount is recomputed here from dates and party size. No price the
 * browser sends is ever read.
 */

const router: IRouter = Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_GUESTS = 5;
const HOUR = 60 * 60 * 1000;

// Generous: the home-page form re-prices as the guest changes dates.
const quoteLimiter = createLimiter(120, HOUR);
const startLimiter = createLimiter(20, HOUR);
const payLimiter = createLimiter(60, HOUR);
const utrLimiter = createLimiter(10, HOUR);

function ipOf(req: Request): string {
  return req.ip ?? "unknown";
}

function text(value: unknown, max: number): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw.slice(0, max) : null;
}

function whole(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return min === 0 ? 0 : null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

/** Today's date in India — what "the past" means for a check-in. */
function todayInIndia(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function notReady(res: import("express").Response) {
  res.status(503).json({
    error: "Online booking is not switched on yet. Please send an enquiry or WhatsApp us instead.",
  });
}

type Party = { checkIn: string; checkOut: string; adults: number; children: number; pets: number };

/** Dates and party from a request body, or the reason they are unusable. */
function readParty(body: unknown): { ok: true; party: Party } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const checkIn = text(b.checkIn, 10);
  const checkOut = text(b.checkOut, 10);
  if (!checkIn || !checkOut || !ISO_DATE.test(checkIn) || !ISO_DATE.test(checkOut)) {
    return { ok: false, error: "Choose a check-in and check-out date." };
  }
  if (checkOut <= checkIn) return { ok: false, error: "Check-out must be after check-in." };
  if (checkIn < todayInIndia()) return { ok: false, error: "Check-in cannot be in the past." };
  if (nightsOf(checkIn, checkOut).length > 30) {
    return { ok: false, error: "For stays longer than 30 nights, please send an enquiry." };
  }

  const adults = whole(b.adults, 1, MAX_GUESTS);
  const children = whole(b.children, 0, MAX_GUESTS);
  const pets = whole(b.pets, 0, 4);
  if (adults === null || children === null || pets === null) {
    return { ok: false, error: "Check the number of guests and pets." };
  }
  if (adults + children > MAX_GUESTS) {
    return {
      ok: false,
      error: `Online booking is for up to ${MAX_GUESTS} guests. For a larger party, please send an enquiry.`,
    };
  }

  return { ok: true, party: { checkIn, checkOut, adults, children, pets } };
}

function priceParty(plan: RatePlan, party: Party, settings: BookPaySettings): QuoteResult {
  return quoteForEnquiry(
    party,
    (isoDate, guests) => rateForNight(plan, isoDate, guests),
    {
      nightPrices: (nights, guests) => stayNightPrices(plan, nights, guests),
      minimumStay: (nights) => minimumStay(plan, nights),
      advancePercent: settings.advancePercent,
    },
  );
}

/** Each night as the guest should see it: date, price, weekend, peak. */
function perNight(plan: RatePlan, party: Party, quote: QuoteResult) {
  if (!quote.ok) return [];
  const nights = nightsOf(party.checkIn, party.checkOut);
  const prices = stayNightPrices(plan, nights, quote.breakdown.ratedGuests);
  const surcharge = quote.extraGuestPaise / Math.max(quote.nights, 1);
  return nights.map((date, index) => ({
    date,
    paise: (prices[index] ?? 0) + surcharge,
    weekend: isWeekendNight(date),
    peak: peakFor(plan.peaks, date)?.label ?? null,
  }));
}

/* -------------------------------- public ------------------------------- */

router.post("/book/quote", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (quoteLimiter(ipOf(req))) {
    res.status(429).json({ error: "Too many price checks from this connection. Please try again in an hour." });
    return;
  }

  const read = readParty(req.body);
  if (!read.ok) {
    res.status(400).json({ error: read.error });
    return;
  }
  const { party } = read;

  try {
    const [plan, settings, taken] = await Promise.all([
      getRatePlan(),
      getBookPaySettings(),
      readTakenRanges(),
    ]);
    const quote = priceParty(plan, party, settings);
    const stay = { startDate: party.checkIn, endDate: party.checkOut };
    const today = todayInIndia();

    if (!quote.ok) {
      // Usually a peak minimum stay. Say so, and offer stays that meet it.
      const min = minimumStay(plan, nightsOf(party.checkIn, party.checkOut));
      res.json({
        available: false,
        reason: quote.reason,
        nextFree: nextFreeWindows(stay, taken, { today, minNights: min?.minNights }),
      });
      return;
    }

    const clash = clashesWith(stay, taken);
    if (clash) {
      res.json({
        available: false,
        reason: "Some of those nights are already taken.",
        nextFree: nextFreeWindows(stay, taken, { today }),
      });
      return;
    }

    res.json({
      available: true,
      checkIn: quote.checkIn,
      checkOut: quote.checkOut,
      nights: quote.nights,
      guests: quote.guests,
      perNight: perNight(plan, party, quote),
      roomPaise: quote.roomPaise,
      extraGuestPaise: quote.extraGuestPaise,
      petPaise: quote.petPaise,
      totalPaise: quote.totalPaise,
      advancePaise: quote.advancePaise,
      balancePaise: quote.balancePaise,
      advancePercent: settings.advancePercent,
      holdMinutes: settings.holdMinutes,
      onlineBooking: upiDetails() !== null,
    });
  } catch (error) {
    logger.error({ err: error }, "Book & Pay quote failed");
    res.status(500).json({ error: "Could not price those dates just now. Please try again." });
  }
});

router.post("/book/start", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (startLimiter(ipOf(req))) {
    res.status(429).json({ error: "Too many booking attempts from this connection. Please try again in an hour." });
    return;
  }
  if (!upiDetails()) {
    notReady(res);
    return;
  }

  const read = readParty(req.body);
  if (!read.ok) {
    res.status(400).json({ error: read.error });
    return;
  }

  const name = text(req.body?.name, 120);
  const rawPhone = text(req.body?.phone, 40);
  const phone = rawPhone ? normaliseMobile(rawPhone) : null;
  const email = text(req.body?.email, 200);

  if (!name || name.length < 2) {
    res.status(400).json({ error: "Please enter your name." });
    return;
  }
  if (!phone) {
    res.status(400).json({ error: "Please enter a 10-digit Indian mobile number." });
    return;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "That email address does not look right." });
    return;
  }

  const input: StartInput = {
    ...read.party,
    name,
    phone,
    email,
    requests: text(req.body?.requests, 1000),
  };

  try {
    const [plan, settings] = await Promise.all([getRatePlan(), getBookPaySettings()]);
    const now = new Date();
    const result = await startHold(
      pgStartStore,
      input,
      priceParty(plan, read.party, settings),
      settings,
      now,
      todayInIndia(now),
    );

    if (!result.ok) {
      res.status(result.status).json(
        result.status === 409 ? { error: result.error, nextFree: result.nextFree } : { error: result.error },
      );
      return;
    }

    logger.info(
      { paymentRequestId: result.paymentRequestId, enquiryId: result.enquiryId },
      "Book & Pay hold started",
    );

    // The token travels in the URL FRAGMENT, as /pre-arrival's does: a
    // fragment never reaches a server log or a Referer header.
    res.status(201).json({
      payUrl: `/pay#${result.token}`,
      token: result.token,
      reference: result.reference,
      holdExpiresAt: result.holdExpiresAt.toISOString(),
    });
  } catch (error) {
    if (isNotMigrated(error)) {
      notReady(res);
      return;
    }
    logger.error({ err: error }, "Book & Pay start failed");
    res.status(500).json({ error: "Could not hold those dates just now. Please try again." });
  }
});

/** What the /pay page shows. Bearer token in the body, never the URL. */
router.post("/book/pay", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (payLimiter(ipOf(req))) {
    res.status(429).json({ error: "Too many requests. Please wait a little and refresh." });
    return;
  }

  const token = req.body?.token;
  if (!looksLikePayToken(token)) {
    res.status(404).json({ error: "This payment link is not valid." });
    return;
  }

  try {
    const found = await findByToken(token);
    if (!found) {
      res.status(404).json({ error: "This payment link is not valid." });
      return;
    }

    const { request, enquiry } = found;
    const now = new Date();
    const live = holdBlocks(request, now);
    const expired = request.status === "awaiting_payment" && !live;
    const upi = upiDetails();
    const payable = request.status === "awaiting_payment" && live && upi !== null;

    const upiUrl = payable
      ? upiIntentUrl({
          upiId: upi!.id,
          payeeName: upi!.name,
          amountPaise: request.advancePaise,
          note: request.reference,
        })
      : null;

    res.json({
      reference: request.reference,
      status: expired ? "expired" : request.status,
      statusText: guestStatusText(request.status, expired),
      guestFirstName: enquiry.name.split(/\s+/)[0],
      checkIn: enquiry.checkIn,
      checkOut: enquiry.checkOut,
      nights: enquiry.checkIn && enquiry.checkOut ? nightsOf(enquiry.checkIn, enquiry.checkOut).length : 0,
      guests: (enquiry.adults ?? 0) + (enquiry.children ?? 0),
      pets: enquiry.pets ?? 0,
      totalPaise: request.totalPaise,
      advancePaise: request.advancePaise,
      balancePaise: request.totalPaise - request.advancePaise,
      advancePercent: request.advancePercent,
      holdExpiresAt: request.holdExpiresAt.toISOString(),
      secondsLeft: request.status === "awaiting_payment" ? secondsLeft(request.holdExpiresAt, now) : 0,
      utrSubmitted: Boolean(request.utr),
      payee: payable ? { upiId: upi!.id, name: upi!.name } : null,
      upiUrl,
      qrSvg: upiUrl
        ? await QRCode.toString(upiUrl, { type: "svg", errorCorrectionLevel: "M", margin: 1 })
        : null,
    });
  } catch (error) {
    if (isNotMigrated(error)) {
      notReady(res);
      return;
    }
    logger.error({ err: error }, "Book & Pay page lookup failed");
    res.status(500).json({ error: "Could not load this payment just now. Please refresh." });
  }
});

router.post("/book/pay/utr", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (utrLimiter(ipOf(req))) {
    res.status(429).json({ error: "Too many attempts. Please WhatsApp us the payment screenshot instead." });
    return;
  }

  const token = req.body?.token;
  if (!looksLikePayToken(token)) {
    res.status(404).json({ error: "This payment link is not valid." });
    return;
  }

  const utr = normaliseUtr(req.body?.utr);
  if (!utr) {
    res.status(400).json({ error: "The UPI transaction ID (UTR) is the 12-digit number in your UPI app's payment details." });
    return;
  }

  let screenshot: { bytes: Buffer; mime: string } | null = null;
  if (req.body?.screenshot) {
    const checked = checkScreenshot(req.body.screenshot ?? {});
    if (!checked.ok) {
      res.status(400).json({ error: checked.reason });
      return;
    }
    screenshot = { bytes: checked.bytes, mime: checked.mime };
  }

  try {
    const found = await findByToken(token);
    if (!found) {
      res.status(404).json({ error: "This payment link is not valid." });
      return;
    }

    const result = await submitUtr(found.request.id, utr, screenshot);
    if (!result.ok) {
      const message = {
        duplicate_utr: "That transaction ID has already been used for another booking. Please check it, or WhatsApp us the screenshot.",
        not_awaiting: "This booking is no longer waiting for payment.",
        expired: "This hold expired before the payment details arrived. If you have paid, please WhatsApp us the screenshot and we will sort it out.",
      }[result.reason];
      res.status(result.reason === "duplicate_utr" ? 409 : 410).json({ error: message });
      return;
    }

    await logPaymentEvent(result.request.id, "utr_submitted", `UTR ${utr}${screenshot ? " + screenshot" : ""}`);
    logger.info({ paymentRequestId: result.request.id }, "Book & Pay UTR submitted");

    // Tell the owner now. Neither channel failing changes the guest's answer.
    const alert = ownerUtrAlert({
      guestName: found.enquiry.name,
      guestPhone: found.enquiry.phone,
      reference: result.request.reference,
      checkIn: found.enquiry.checkIn,
      checkOut: found.enquiry.checkOut,
      advancePaise: result.request.advancePaise,
      utr,
      hasScreenshot: Boolean(screenshot),
      decideBy: result.request.holdExpiresAt,
      adminUrl: `${SITE_ORIGIN}/admin/guests#payments`,
    });
    void (async () => {
      await sendEmail(await ownerEmail(), alert.subject, alert.text);
      await sendWhatsappTemplate(process.env["OWNER_WHATSAPP_NUMBER"], "WHATSAPP_OWNER_ALERT_TEMPLATE", [
        found.enquiry.name,
        `₹${result.request.advancePaise / 100}`,
        utr,
        result.request.reference,
      ]);
    })();

    res.json({
      status: "submitted",
      statusText: guestStatusText("submitted", false),
    });
  } catch (error) {
    logger.error({ err: error }, "Book & Pay UTR submission failed");
    res.status(500).json({ error: "Could not save that just now. Please try again." });
  }
});

/* -------------------------------- admin -------------------------------- */

function idParam(raw: unknown): string | null {
  return typeof raw === "string" && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
}

function waLink(phone: string | null, message: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  const to = digits.length === 10 ? `91${digits}` : digits.length === 11 && digits.startsWith("0") ? `91${digits.slice(1)}` : digits;
  return to.length >= 11 ? `https://wa.me/${to}?text=${encodeURIComponent(message)}` : null;
}

router.get("/admin/book-pay", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const [settings, rows] = await Promise.all([getBookPaySettings(), listForAdmin()]);
    const now = new Date();
    res.json({
      settings,
      upiReady: upiDetails() !== null,
      payments: rows.map((row) => ({
        ...row,
        overdue: row.status === "submitted" && now >= row.holdExpiresAt,
        // For an expired hold the guest was not told about automatically.
        rebookWhatsappUrl:
          row.status === "expired" && !row.expiryNotifiedAt
            ? waLink(
                row.guestPhone,
                expiredMessage({
                  guestName: row.guestName,
                  checkIn: row.checkIn,
                  checkOut: row.checkOut,
                  rebookUrl: `${SITE_ORIGIN}/#booking`,
                }).text,
              )
            : null,
      })),
    });
  } catch (error) {
    if (isNotMigrated(error)) {
      res.json({ settings: await getBookPaySettings(), upiReady: upiDetails() !== null, payments: [], migrationNeeded: true });
      return;
    }
    throw error;
  }
});

router.put("/admin/book-pay/settings", requireAdmin, async (req, res) => {
  const settings: BookPaySettings = {
    advancePercent: Number(req.body?.advancePercent),
    holdMinutes: Number(req.body?.holdMinutes),
  };
  const problem = settingsProblem(settings);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  await saveBookPaySettings(settings);
  res.json({ settings });
});

router.get("/admin/book-pay/:id/screenshot", requireAdmin, async (req, res) => {
  const id = idParam(req.params.id);
  const shot = id ? await getScreenshot(id) : null;
  if (!shot) {
    res.status(404).json({ error: "No screenshot." });
    return;
  }
  // Bytes were checked against their type on upload; still never sniffed,
  // never scripted, never cached.
  res.set({
    "Content-Type": shot.mime,
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
    "Cache-Control": "no-store, private",
  });
  res.send(shot.bytes);
});

/**
 * Confirm: exactly what the owner would otherwise click by hand —
 * advance-received, then convert — so the booking is created by the same
 * code as every other converted enquiry.
 */
router.post("/admin/book-pay/:id/confirm", requireAdmin, async (req, res) => {
  const id = idParam(req.params.id);
  const found = id ? await findById(id) : null;
  if (!found) {
    res.status(404).json({ error: "That payment no longer exists." });
    return;
  }
  const { request } = found;
  if (request.status !== "submitted" && request.status !== "awaiting_payment") {
    res.status(409).json({ error: `This payment is already ${request.status}.` });
    return;
  }

  // An OTA may have sold the nights before its next sync picked up the hold.
  // The ledger check inside convert would miss that; look at the calendar.
  if (req.body?.force !== true && found.enquiry.checkIn && found.enquiry.checkOut) {
    const otaClash = await db
      .select({ id: calendarEvents.id, source: calendarEvents.source, startDate: calendarEvents.startDate, endDate: calendarEvents.endDate })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.status, "confirmed"),
          inArray(calendarEvents.source, ["bookingCom", "airbnb", "makeMyTrip", "manual"]),
          lt(calendarEvents.startDate, found.enquiry.checkOut),
          gt(calendarEvents.endDate, found.enquiry.checkIn),
        ),
      )
      .limit(1);
    if (otaClash[0]) {
      res.status(409).json({
        error: `The calendar shows ${otaClash[0].source} holding ${otaClash[0].startDate} to ${otaClash[0].endDate}. Check for a double booking before confirming.`,
        reason: "calendar_clash",
      });
      return;
    }
  }

  // Step 1 — the same mark as POST /enquiries/:id/advance-received.
  await setAdvancePaid(request.enquiryId, true);
  const enquiry = await getEnquiry(request.enquiryId);
  if (!enquiry) {
    res.status(404).json({ error: "The enquiry behind this payment no longer exists." });
    return;
  }

  // Step 2 — the same conversion as POST /enquiries/:id/convert.
  const outcome = await convertEnquiry(enquiry, { reference: request.reference });
  if (!outcome.ok) {
    // Leave nothing half-done: the advance mark goes back off.
    await setAdvancePaid(request.enquiryId, false);
    const { ok: _ok, status, ...body } = outcome;
    res.status(status).json(body);
    return;
  }

  await setDecision(request.id, "confirmed");
  await logPaymentEvent(request.id, "confirmed", `Booking ${outcome.booking.reference}`);

  // Guest message: reference, dates, balance, pre-arrival link.
  const onboarding = await createOrRefreshOnboarding(outcome.booking.id).catch(() => null);
  const preArrivalUrl = onboarding ? `${SITE_ORIGIN}/pre-arrival#${encodeURIComponent(onboarding.token)}` : null;
  const message = confirmedMessage({
    guestName: enquiry.name,
    reference: outcome.booking.reference ?? request.reference,
    checkIn: enquiry.checkIn,
    checkOut: enquiry.checkOut,
    advancePaise: request.advancePaise,
    balancePaise: request.totalPaise - request.advancePaise,
    preArrivalUrl,
  });
  const emailed = await sendEmail(enquiry.email, message.subject, message.text);

  res.json({
    booking: {
      id: outcome.booking.id,
      reference: outcome.booking.reference,
      status: outcome.booking.status,
      receivedPaise: outcome.booking.receivedPaise,
    },
    emailed,
    // Today's delivery path for WhatsApp: the owner presses send.
    whatsappUrl: waLink(enquiry.phone, message.text),
    preview: message.text,
  });
});

router.post("/admin/book-pay/:id/reject", requireAdmin, async (req, res) => {
  const id = idParam(req.params.id);
  const reason = text(req.body?.reason, 300);
  if (!id) {
    res.status(400).json({ error: "Invalid payment id." });
    return;
  }
  if (!reason) {
    res.status(400).json({ error: "Add a short reason — it is kept with the record." });
    return;
  }

  const updated = await setDecision(id, "rejected", reason);
  if (!updated) {
    res.status(409).json({ error: "This payment has already been decided." });
    return;
  }

  // Dates are free from this moment: holds are derived from status.
  await setEnquiryStatus(updated.enquiryId, "closed");
  await logPaymentEvent(id, "rejected", reason);
  logger.info({ paymentRequestId: id }, "Book & Pay payment rejected");

  res.json({ status: "rejected" });
});

/** The owner sent the "hold expired" message by hand from the console. */
router.post("/admin/book-pay/:id/expiry-notified", requireAdmin, async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid payment id." });
    return;
  }
  await markExpiryNotified(id);
  await logPaymentEvent(id, "expiry_notified", "Sent by the owner on WhatsApp");
  res.json({ ok: true });
});

export default router;
