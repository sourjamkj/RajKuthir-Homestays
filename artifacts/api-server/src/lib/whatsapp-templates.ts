import type { Booking } from "@workspace/db";
import { buildEnquiryFollowUp } from "./enquiry-followup.ts";

import type { Quote } from "./enquiry-quote.ts";
import { formatDeadline, HOLD_HOURS } from "./enquiry-hold.ts";
import {
  LEAVE_REVIEW_URL,
  REVIEW_TEMPLATE_NAMES,
  pickReviewVariant,
  reviewRequestText,
  type ReviewVariant,
} from "./review-rules.ts";

/**
 * The four message templates, and how a booking fills them in.
 *
 * `name` must match a template approved in Meta > WhatsApp Manager exactly,
 * and the number of `{{n}}` placeholders in Meta's body must match the
 * `params` array below or the send is rejected. `preview` exists so the owner
 * can read what a guest will receive without logging into Meta.
 *
 * Category matters for cost and consent: utility templates are transactional
 * and cheap; marketing templates need opt-in and are billed higher. Keep the
 * category here in step with what was submitted for approval.
 */

export type MessageKind =
  | "booking_confirmed"
  | "checkin_reminder"
  | "checkin_welcome"
  | "checkout_today"
  | "review_request"
  | "verification_reminder"
  | "owner_new_booking";

export type TemplateSpec = {
  name: string;
  category: "utility" | "marketing";
  languageCode: string;
  params: string[];
  preview: string;
};

const CONTACT = {
  hostPhone: "+91 62903 99165",
  caretakerPhone: "+91 78726 85558",
  mapsUrl: "https://maps.app.goo.gl/aEdaJaaeEy1DZ8Ps8?g_st=ac",
  reviewUrl: "https://maps.app.goo.gl/Ptrm6eaXuXNoiXBbA?g_st=ac",
  /** Google's "write a review" box for the listing — same as CONFIG.leaveReviewUrl. */
  leaveReviewUrl: "https://g.page/r/CR9H9DboJM75EBM/review",
};

/** "2026-09-14" -> "14 Sep 2026", which is how a guest reads a date. */
export function prettyDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

const SOURCE_LABEL: Record<string, string> = {
  direct: "website",
  bookingCom: "Booking.com",
  airbnb: "Airbnb",
  makeMyTrip: "MakeMyTrip",
};

/**
 * The checkout template handed to Meta: rk_checkout_deposit (call the
 * caretaker, deposit refund) once WHATSAPP_CHECKOUT_TEMPLATE names it, the
 * approved rk_checkout_today until then. Same two params either way.
 */
export function checkoutTemplateName(): string {
  return process.env["WHATSAPP_CHECKOUT_TEMPLATE"]?.trim() || "rk_checkout_today";
}

/** First name only — "Dear Mr Sourja Mukherjee" reads like a bank letter. */
function firstName(full: string | null): string {
  const name = (full ?? "").trim().split(/\s+/)[0];
  return name || "there";
}

export function buildTemplate(
  kind: MessageKind,
  booking: Booking,
): TemplateSpec {
  const guest = firstName(booking.guestName);
  const arrive = prettyDate(booking.checkIn);
  const depart = prettyDate(booking.checkOut);
  const nights = nightsBetween(booking.checkIn, booking.checkOut);

  switch (kind) {
    case "booking_confirmed":
      // The confirmation PDF with the house rules, after ID verification. Sent
      // by invoices.ts as WHATSAPP_CONFIRMATION_TEMPLATE with the PDF header.
      return {
        name: "rk_booking_confirmation_pdf",
        category: "utility",
        languageCode: "en",
        params: [guest, booking.reference ?? ""],
        preview:
          `Hello ${guest}, thank you — your ID is verified. Your booking confirmation for ${arrive} to ${depart} ` +
          `is attached, with the house rules. See you soon!`,
      };

    case "checkin_reminder":
      return {
        name: "rk_checkin_reminder",
        category: "utility",
        languageCode: "en",
        params: [guest, arrive, CONTACT.caretakerPhone],
        preview:
          `Hello ${guest}, we are looking forward to seeing you tomorrow, ${arrive}. ` +
          `Check-in is from 12 noon. Directions: ${CONTACT.mapsUrl} — ` +
          `our caretaker is on ${CONTACT.caretakerPhone} if anything comes up on the way.`,
      };

    case "checkin_welcome":
      // Sent with the Wi-Fi poster PDF as its Document header (notifications.ts).
      return {
        name: "rk_checkin_welcome",
        category: "utility",
        languageCode: "en",
        params: [guest, CONTACT.caretakerPhone],
        preview:
          `Hello ${guest} 🌿 Welcome to Raj Kuthir Homestays – Sobuj Potro! The villa is ready for you from 12 noon today. ` +
          `The attached poster has the Wi-Fi QR code (open your phone camera and scan it to connect) and our important contact numbers. ` +
          `Caretaker (arrival, meals, local help): ${CONTACT.caretakerPhone}.`,
      };

    case "checkout_today":
      return {
        name: "rk_checkout_today",
        category: "utility",
        languageCode: "en",
        params: [guest, CONTACT.caretakerPhone],
        preview:
          `Good morning ${guest}! Check-out is by 11 am today. Before you leave, please call our caretaker on ${CONTACT.caretakerPhone} ` +
          `so the villa can be checked together — that lets us refund your security deposit quickly and smoothly. ` +
          `Thank you for staying with us, travel safely.`,
      };

    case "verification_reminder":
      // The "Upload ID" button's URL ends in a fresh pre-arrival token, added at
      // send time (notifications.ts), so no token is ever stored in the outbox.
      return {
        name: "rk_verification_reminder",
        category: "utility",
        languageCode: "en",
        params: [guest, arrive],
        preview:
          `Hello ${guest}, your stay at Raj Kuthir Homestays – Sobuj Potro begins on ${arrive}. ` +
          `Please complete the mandatory guest information and ID document verification (Upload ID below) at least 48 hours before your check-in time. ` +
          `⚠️ Failure to complete the mandatory verification within this timeframe may result in check-in being denied without refund, in accordance with the booking terms. ` +
          `Your confirmation, arrival details and Wi-Fi pack follow once your ID is verified.`,
      };

    case "owner_new_booking": {
      const via = SOURCE_LABEL[booking.source] ?? booking.source;
      const party = booking.guests ? String(booking.guests) : "?";
      const ref = booking.reference ?? "no ref";
      return {
        name: "rk_owner_new_booking",
        category: "utility",
        languageCode: "en",
        params: [booking.guestName?.trim() || "Guest", arrive, depart, party, via, ref],
        preview: `New booking: ${booking.guestName ?? "Guest"}, ${arrive} to ${depart}, ${party} guests, via ${via}. Ref ${ref}.`,
      };
    }

    case "review_request":
      // Three variants since Oct 2026 — see review-rules.ts for the choice.
      return reviewTemplate(pickReviewVariant({ pets: booking.pets, nights }).variant, booking);
  }
}


/**
 * One review-request variant for a booking. All three take the same two
 * params as the old rk_review_request — first name, review link — so the
 * outbox can fall back to the old template until Meta approves the new ones.
 */
export function reviewTemplate(variant: ReviewVariant, booking: Pick<Booking, "guestName">): TemplateSpec {
  const guest = firstName(booking.guestName);
  return {
    name: REVIEW_TEMPLATE_NAMES[variant],
    category: "marketing",
    languageCode: "en",
    params: [guest, LEAVE_REVIEW_URL],
    preview: reviewRequestText(variant, guest, LEAVE_REVIEW_URL),
  };
}

/* ---------------------------------------------------------------------- *
 * The enquiry quote
 *
 * Deliberately not one of the four `MessageKind`s above. Those go through the
 * outbox, which lives in `whatsapp_messages` and in the `message_kind`
 * Postgres enum; adding a fifth would mean altering an enum in a table that
 * does not exist in production yet. A quote is sent once, by hand, from the
 * enquiries screen, and recorded on the enquiry row itself — so it needs none
 * of that machinery and does not wait for it.
 * ---------------------------------------------------------------------- */

/**
 * Where to send the money, read from the environment rather than committed.
 *
 * A UPI handle in a git history is there permanently and travels with every
 * clone and fork. It is also the one thing here most likely to change — a new
 * bank, a new handle — and a Railway variable changes in a minute, whereas a
 * value baked into an approved WhatsApp template takes days to re-approve.
 * Hence `{{8}}`: the payee reaches Meta as a parameter, not as fixed text.
 *
 * Read per call so a change takes effect on restart, without a rebuild.
 */
export function upiDetails(): { id: string; name: string } | null {
  const id = process.env["RAJ_KUTHIR_UPI_ID"]?.trim();
  const name = process.env["RAJ_KUTHIR_UPI_NAME"]?.trim();
  return id && name ? { id, name } : null;
}

/** Paise to the way a price is written in India: 1,24,500 rather than 124,500. */
export function rupees(paise: number): string {
  const value = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * The quote a guest receives after enquiring.
 *
 * Every figure here comes from `quoteForEnquiry`, which refuses rather than
 * guesses, so this function never has to decide what to do about a missing
 * price — by the time it is called there is one.
 */
export function buildEnquiryQuoteTemplate(input: {
  guestName: string | null;
  /** The rate-card quote, or the owner's agreed price with its breakdown (withAgreedPrice). */
  quote: Quote & { agreed?: boolean; priceNote?: string | null };
  upi: { id: string; name: string };
  /** When the dates stop being held. Derived, never stored — see enquiry-hold. */
  holdExpiresAt: Date;
  /** The guest's ready-to-pay link (dates and price filled in), when there is one. */
  offerUrl?: string | null;
}): TemplateSpec {
  const guest = firstName(input.guestName);
  const arrive = prettyDate(input.quote.checkIn);
  const depart = prettyDate(input.quote.checkOut);
  const nights = String(input.quote.nights);
  const guests = String(input.quote.guests);
  const total = rupees(input.quote.totalPaise);
  const advance = rupees(input.quote.advancePaise);
  const deadline = formatDeadline(input.holdExpiresAt);
  const payee = `${input.upi.id} (${input.upi.name})`;

  return {
    name: "rk_enquiry_quote",
    category: "utility",
    languageCode: "en",
    params: [
      guest,
      arrive,
      depart,
      nights,
      guests,
      total,
      advance,
      deadline,
      payee,
    ],
    /*
      The manual-WhatsApp message (and the record of what was quoted). The
      Business API template's parameters above are unchanged; this text adds
      the owner's breakdown, says "in full" when nothing is left to pay at
      check-in, and links the photos, the food and the live calendar.
    */
    // The owner's enquiry format (Nov 2026), the same text as the "Reply on
    // WhatsApp" message, plus how long the dates are held and UPI as the
    // fallback. The Business API template's parameters above are unchanged.
    preview: buildEnquiryFollowUp(
      {
        name: input.guestName ?? "",
        checkIn: input.quote.checkIn,
        checkOut: input.quote.checkOut,
        adults: input.quote.guests,
        children: 0,
        pets: input.quote.breakdown.pets,
        status: "new",
        createdAt: input.holdExpiresAt,
        quoteSentAt: null,
      },
      {
        quote: { ok: true, ...input.quote },
        datesTaken: null,
        returning: false,
        now: input.holdExpiresAt,
        offerUrl: input.offerUrl ?? null,
        sending: { holdUntil: deadline, upi: payee },
      },
    ),
  };
}

/**
 * The hold window, in words, for the enquiry form and the house rules.
 * One place, so the page and the message can never disagree about it.
 */
export const HOLD_WINDOW_TEXT = `${HOLD_HOURS} hours`;
