import type { QuoteResult } from "./enquiry-quote.ts";
import { PET_NIGHTLY_FROM_NIGHTS, RATE_CARD_MAX_GUESTS, securityDepositNote, surchargePerNight } from "./party.ts";

/**
 * The WhatsApp reply behind "Reply on WhatsApp" / "Follow up" on an enquiry,
 * written once here for the web console and the phone app.
 *
 * It answers with what we already know. When the dates and the party are on
 * the enquiry and the stay can be priced, the reply carries the price (from
 * the quote function, never typed) instead of asking how many are coming. A
 * guest who has stayed before is welcomed back. Most enquiries are now typed
 * in by the owner from a WhatsApp chat, so the reply never claims the guest
 * "enquired on our website".
 *
 * Pure: no database, no clock of its own.
 */

export const SITE = "https://rajkuthirhomestays.casa";
const SIGN = "\n\nWarm regards,\nTeam Raj Kuthir Homestays – Sobuj Potro";
const VILLA =
  "• The entire 2-bedroom villa is yours: 2 AC bedrooms, private garden, parking, Wi-Fi\n" +
  "• Pets welcome\n" +
  "• Booking direct costs less than the booking apps";

/**
 * What the guest needs to decide, with the pages that show it: the food
 * (Cafe Soi in the grounds, home-cooked meals through the caretaker), the
 * photos, the full tariff and the live calendar. Every reply carries it, the
 * one with a price included.
 */
const DETAILS =
  `• Food: Cafe Soi in the villa grounds serves breakfast, Bengali home cooking, tea and snacks (menu: ${SITE}/cafe-soi-shantiniketan). Home-cooked meals can also be arranged with the caretaker.\n` +
  `• Photos: ${SITE}/gallery\n` +
  `• Rates: ${SITE}/rates\n` +
  `• Live availability: ${SITE}/#availability`;

export type FollowUpEnquiry = {
  name: string;
  checkIn: string | null;
  checkOut: string | null;
  adults: number | null;
  children: number | null;
  pets: number | null;
  status: "new" | "contacted" | "converted" | "closed";
  createdAt: Date | string;
  quoteSentAt: Date | string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "6 Nov" */
export function shortDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m! - 1]}`;
}

/** "Fri, 6 Nov" */
export function weekdayDay(iso: string): string {
  return `${DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]}, ${shortDay(iso)}`;
}

function rupees(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function followUpBody(
  row: FollowUpEnquiry,
  input: {
    /** The rate-card quote, or the owner's agreed price (withAgreedPrice). */
    quote: QuoteResult & { agreed?: boolean; priceNote?: string | null };
    datesTaken: { startDate: string; endDate: string } | null;
    /** Has stayed with us before. */
    returning: boolean;
    now: Date;
    /** The guest's ready-to-pay link (dates and price filled in), when there is one. */
    offerUrl?: string | null;
    /** When the quote is being sent: how long the dates are held, and UPI as the fallback. */
    sending?: { holdUntil: string; upi: string };
  },
): string {
  const first = row.name.trim().split(/\s+/)[0] || "there";
  const offer = input.quote.ok && input.offerUrl ? input.offerUrl : null;
  const bookLine = offer ? `\n\nBook in one step (your dates and price are already filled in):\n${offer}` : "";
  const dates = row.checkIn && row.checkOut ? `${shortDay(row.checkIn)} – ${shortDay(row.checkOut)}` : null;
  const hello = input.returning
    ? `Hi ${first}, welcome back to Raj Kuthir Homestays – Sobuj Potro! Lovely to hear from you again.`
    : `Hi ${first}, this is Raj Kuthir Homestays – Sobuj Potro, Shantiniketan. Thank you for getting in touch!`;

  if (input.datesTaken && dates) {
    return (
      `${input.returning ? `Hi ${first}, lovely to hear from you again.` : `Hi ${first}, thank you for your interest in Raj Kuthir Homestays – Sobuj Potro, Shantiniketan.`}\n\n` +
      `I'm sorry, the villa is already booked for ${dates}. ` +
      `If your dates are flexible, I'd be glad to host you on another day. Share the dates that suit you and I will send you the best direct rate.\n\n` +
      `See which dates are open: ${SITE}/#availability${SIGN}`
    );
  }

  if (row.status === "contacted") {
    if (row.quoteSentAt) {
      return (
        `Hi ${first}, just following up on the quote we sent${dates ? ` for ${dates}` : ""}. ` +
        `Happy to answer any questions or adjust the dates. Shall I confirm it for you?${bookLine}${SIGN}`
      );
    }
    if (input.quote.ok) {
      return (
        `Hi ${first}, just checking in about ${dates ?? "your stay"}: the villa is still free and the total is ${rupees(input.quote.totalPaise)}. ` +
        `Shall I hold the dates for you?${bookLine}${SIGN}`
      );
    }
    return (
      `Hi ${first}, just checking in — happy to hold dates for you if you are still thinking about ` +
      `Shantiniketan this season. Send me your dates whenever you are ready 🙂${SIGN}`
    );
  }

  const waited = input.now.getTime() - new Date(row.createdAt).getTime() > 24 * 60 * 60 * 1000;
  const sorry = waited ? "Sorry we did not get back sooner.\n\n" : "";
  const knowsParty = (row.adults ?? 0) + (row.children ?? 0) > 0;

  // Dates and party known, and the stay prices: answer with the price.
  if (input.quote.ok && knowsParty) {
    const q = input.quote;
    const pets = row.pets ?? 0;
    const agreed = input.quote.agreed === true;
    // One format for every priced reply (the owner's, Nov 2026): the stay, the
    // price night by night, pets, total and advance. The owner's own breakdown
    // when he agreed a price; the rate card's otherwise.
    const lines = [
      `• Check-in: ${weekdayDay(q.checkIn)}, from 12 noon`,
      `• Check-out: ${weekdayDay(q.checkOut)}, by 11 am`,
      `• Stay: ${plural(q.nights, "night")} for ${plural(q.guests, "guest")}${pets > 0 ? ` and ${plural(pets, "pet")}` : ""}`,
      ...(agreed ? breakdownLines(input.quote.priceNote) : rateCardLines(q, pets)),
      `• Total: ${rupees(q.totalPaise)}`,
      q.balancePaise > 0
        ? `• Advance to confirm: ${rupees(q.advancePaise)}, the balance at check-in`
        : `• To confirm: ${rupees(q.advancePaise)}, the full amount${q.peak ? ` (${q.peak} stays are paid in full at booking)` : ""}`,
      `• ${securityDepositNote()}`,
      input.sending ? `• We hold these dates for you until ${input.sending.holdUntil}` : null,
    ].filter((line): line is string => line !== null);
    return (
      `${hello}\n\n${sorry}` +
      `Yes, the villa is free for your dates.\n${lines.join("\n")}\n\n` +
      `${VILLA}\n${DETAILS}\n\n` +
      (offer
        ? `To book, open your link below: your dates, guests and price are already filled in. Check your name and pay the advance to confirm.\n${offer}\n\n` +
          (input.sending ? `Or pay by UPI: ${input.sending.upi}, and send us the screenshot here.\n\n` : "") +
          `Any questions, just reply here.${SIGN}`
        : input.sending
          ? `To confirm, pay by UPI: ${input.sending.upi}, and send us the screenshot here.\n\nAny questions, just reply here.${SIGN}`
          : `Shall I hold these dates for you? Reply here and I will send the payment details, or book directly at ${SITE}${SIGN}`)
    );
  }

  const ask = dates
    ? knowsParty
      ? `You asked about ${dates}. Let me check and send you the best direct rate.`
      : `You asked about ${dates}. How many of you are coming, and will you bring any pets? I will send you the best direct rate.`
    : `Are you still planning a trip? Share your dates and number of guests, and I will check availability and send you the best direct rate.`;
  return `${hello}\n\n${sorry}${ask}\n\n${VILLA}\n${DETAILS}${SIGN}`;
}

type FollowUpInput = Parameters<typeof followUpBody>[1];

/**
 * Every reply states the refundable security deposit (the owner's rule):
 * priced replies carry it as a bullet; every other reply gets it as a line
 * just above the signature.
 */
export function buildEnquiryFollowUp(row: FollowUpEnquiry, input: FollowUpInput): string {
  const text = followUpBody(row, input);
  if (text.includes("security deposit")) return text;
  return text.replace(SIGN, `\n\n${securityDepositNote()}.${SIGN}`);
}

/** "14 Nov", "14 and 15 Nov", "14, 15 and 16 Nov", "31 Dec and 1 Jan". */
function dayList(dates: string[]): string {
  const parts = dates.map((iso) => {
    const [, m, d] = iso.split("-").map(Number);
    return { d, m: MONTHS[m! - 1]! };
  });
  const sameMonth = parts.every((p) => p.m === parts[0]!.m);
  const words = parts.map((p, i) => (sameMonth && i < parts.length - 1 ? String(p.d) : `${p.d} ${p.m}`));
  return words.length === 1 ? words[0]! : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/**
 * The rate card's price in the owner's format: nights grouped by price
 * ("14 and 15 Nov: ₹3,500 a night for 5 guests"), extra guests, then pets.
 */
function rateCardLines(q: Extract<QuoteResult, { ok: true }>, pets: number): string[] {
  const rated = Math.min(q.guests, RATE_CARD_MAX_GUESTS);
  const groups = new Map<number, string[]>();
  for (const night of q.nightly ?? []) groups.set(night.paise, [...(groups.get(night.paise) ?? []), night.date]);
  const lines = [...groups].map(([paise, dates]) =>
    dates.length === 1
      ? `• ${dayList(dates)}: ${rupees(paise)} for ${plural(rated, "guest")}`
      : `• ${dayList(dates)}: ${rupees(paise)} a night for ${plural(rated, "guest")}`,
  );
  if (lines.length === 0) lines.push(`• ${plural(q.nights, "night")} for ${plural(rated, "guest")}: ${rupees(q.roomPaise)}`);
  const extra = q.guests - rated;
  if (extra > 0 && q.extraGuestPaise > 0) {
    lines.push(`• ${extra} more guest${extra === 1 ? "" : "s"} with extra bedding: ${rupees(surchargePerNight(q.breakdown))} a night`);
  }
  if (pets > 0 && q.petPaise > 0) {
    lines.push(
      q.nights >= PET_NIGHTLY_FROM_NIGHTS
        ? `• ${plural(pets, "pet")}: ${rupees(q.petPaise / pets / q.nights)} each a night`
        : pets === 1
          ? `• 1 pet: ${rupees(q.petPaise)} for the stay`
          : `• ${plural(pets, "pet")}: ${rupees(q.petPaise / pets)} each for the stay`,
    );
  }
  return lines;
}

/** The agreed price's breakdown as bullets: one per line, any bullet the owner typed removed. */
export function breakdownLines(note: string | null | undefined): string[] {
  return (note ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[•\-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((line) => `• ${line}`);
}

/** A guest who has stayed before: a past stay on file, or tagged by the owner. */
export function isReturningGuest(contact: { stays: number; lastStay: string | null; tags: string | null } | undefined, today: string): boolean {
  if (!contact) return false;
  if (contact.tags && /\b(repeat|returning)\b/i.test(contact.tags)) return true;
  return contact.stays > 0 && contact.lastStay !== null && contact.lastStay < today;
}
