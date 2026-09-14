import type { Booking } from "@workspace/db";

import type { Quote } from "./enquiry-quote.ts";
import { formatDeadline, HOLD_HOURS } from "./enquiry-hold.ts";

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
  | "checkout_today"
  | "review_request";

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
  mapsUrl: "https://maps.app.goo.gl/D1tUUb3JfpVdcHwu5",
  reviewUrl: "https://maps.app.goo.gl/Ptrm6eaXuXNoiXBbA?g_st=ac",
};

/** "2026-09-14" -> "14 Sep 2026", which is how a guest reads a date. */
function prettyDate(iso: string): string {
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
      return {
        name: "rk_booking_confirmed",
        category: "utility",
        languageCode: "en",
        params: [guest, arrive, depart, String(nights)],
        preview:
          `Hello ${guest}, your stay at Raj Kuthir Homestays (Sobuj Potro) is confirmed — ` +
          `${arrive} to ${depart}, ${nights} night${nights === 1 ? "" : "s"}. ` +
          `We will send directions the day before you arrive. ` +
          `Any questions, reply here or call ${CONTACT.hostPhone}.`,
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

    case "checkout_today":
      return {
        name: "rk_checkout_today",
        category: "utility",
        languageCode: "en",
        params: [guest, CONTACT.caretakerPhone],
        preview:
          `Good morning ${guest}. Check-out is by 11 am today. ` +
          `Please leave the keys with the caretaker (${CONTACT.caretakerPhone}). ` +
          `Thank you for staying with us — travel safely.`,
      };

    case "review_request":
      return {
        name: "rk_review_request",
        category: "marketing",
        languageCode: "en",
        params: [guest, CONTACT.reviewUrl],
        preview:
          `Hello ${guest}, we hope you got home well. If Sobuj Potro treated you kindly, ` +
          `a short Google review helps other travellers find us: ${CONTACT.reviewUrl}. ` +
          `Thank you — you are welcome back any time.`,
      };
  }
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
  quote: Quote;
  upi: { id: string; name: string };
  /** When the dates stop being held. Derived, never stored — see enquiry-hold. */
  holdExpiresAt: Date;
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
    preview:
      `Hello ${guest}, thank you for your enquiry about Raj Kuthir Homestays — Sobuj Potro.\n\n` +
      `Your dates: ${arrive} to ${depart} — ${nights} night${input.quote.nights === 1 ? "" : "s"} for ${guests} guest${input.quote.guests === 1 ? "" : "s"}.\n` +
      `Total for the stay: ₹${total}\n` +
      `To confirm, please send ₹${advance} by ${deadline}. The balance is payable at check-in.\n\n` +
      `UPI: ${payee}\n\n` +
      `Reply here with the payment screenshot and we will confirm your booking straight away. ` +
      `If the advance does not reach us by then, these dates are released automatically ` +
      `and offered to other guests.\n\n` +
      `Any questions, call ${CONTACT.hostPhone}.`,
  };
}

/**
 * The hold window, in words, for the enquiry form and the house rules.
 * One place, so the page and the message can never disagree about it.
 */
export const HOLD_WINDOW_TEXT = `${HOLD_HOURS} hours`;
