import type { QuoteResult } from "./enquiry-quote.ts";

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

export function buildEnquiryFollowUp(
  row: FollowUpEnquiry,
  input: {
    /** The rate-card quote, or the owner's agreed price (withAgreedPrice). */
    quote: QuoteResult & { agreed?: boolean; priceNote?: string | null };
    datesTaken: { startDate: string; endDate: string } | null;
    /** Has stayed with us before. */
    returning: boolean;
    now: Date;
  },
): string {
  const first = row.name.trim().split(/\s+/)[0] || "there";
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
        `Happy to answer any questions or adjust the dates. Shall I confirm it for you?${SIGN}`
      );
    }
    if (input.quote.ok) {
      return (
        `Hi ${first}, just checking in about ${dates ?? "your stay"}: the villa is still free and the total is ${rupees(input.quote.totalPaise)}. ` +
        `Shall I hold the dates for you?${SIGN}`
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
    const lines = [
      `• Check-in: ${weekdayDay(q.checkIn)}, from 12 noon`,
      `• Check-out: ${weekdayDay(q.checkOut)}, by 11 am`,
      agreed
        ? `• Stay: ${plural(q.nights, "night")} for ${plural(q.guests, "guest")}${pets > 0 ? ` and ${plural(pets, "pet")}` : ""}`
        : `• Stay: ${plural(q.nights, "night")} for ${plural(q.guests, "guest")}: ${rupees(q.roomPaise + q.extraGuestPaise)}`,
      !agreed && pets > 0 ? `• ${plural(pets, "pet")}: ${rupees(q.petPaise)}` : null,
      // The owner's breakdown, one bullet per line he typed (night by night, extra guests…).
      ...(agreed ? breakdownLines(input.quote.priceNote) : []),
      `• Total: ${rupees(q.totalPaise)}`,
      agreed ? `• Advance to confirm: ${rupees(q.advancePaise)}${q.balancePaise > 0 ? ", the balance at check-in" : ""}` : null,
      q.peak ? `• ${q.peak}: paid in full when you book` : null,
    ].filter((line): line is string => line !== null);
    return (
      `${hello}\n\n${sorry}` +
      `Yes, the villa is free for your dates.\n${lines.join("\n")}\n\n` +
      `${VILLA}\n${DETAILS}\n\n` +
      `Shall I hold these dates for you? Reply here and I will send the payment details, or book directly at ${SITE}${SIGN}`
    );
  }

  const ask = dates
    ? knowsParty
      ? `You asked about ${dates}. Let me check and send you the best direct rate.`
      : `You asked about ${dates}. How many of you are coming, and will you bring any pets? I will send you the best direct rate.`
    : `Are you still planning a trip? Share your dates and number of guests, and I will check availability and send you the best direct rate.`;
  return `${hello}\n\n${sorry}${ask}\n\n${VILLA}\n${DETAILS}${SIGN}`;
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
