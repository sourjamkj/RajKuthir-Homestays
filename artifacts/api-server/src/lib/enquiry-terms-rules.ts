import { advanceOf, ADVANCE_PERCENT, nightsOf, type QuoteResult } from "./enquiry-quote.ts";
import { breakdownOf } from "./party.ts";

/**
 * What the owner knows about an enquiry beyond the form fields: the
 * children's ages, a private note, and the price he agreed with the guest.
 *
 * Most enquiries now arrive on WhatsApp or a phone call, and the owner's deal
 * ("₹3,500 a night for five, ₹750 for each extra guest with bedding") is not
 * the rate card. An agreed total, when set, replaces the rate-card price in
 * the quote, the WhatsApp reply and the booking form, so nothing has to be
 * typed twice. Pure: no database, no clock.
 */

export type EnquiryTerms = {
  childrenAges: string | null;
  ownerNote: string | null;
  /** The whole stay, everything included, in paise. */
  agreedTotalPaise: number | null;
  /** The advance asked for, in paise. Null: the usual share of the agreed total. */
  agreedAdvancePaise: number | null;
  /** How the agreed price is made up, in the owner's words, one line per bullet; shown to the guest. */
  priceNote: string | null;
};

export const NO_TERMS: EnquiryTerms = {
  childrenAges: null,
  ownerNote: null,
  agreedTotalPaise: null,
  agreedAdvancePaise: null,
  priceNote: null,
};

/** Columns on the enquiry itself that the owner may correct. */
export type EnquiryFieldsPatch = Partial<{
  name: string;
  phone: string;
  email: string | null;
  checkIn: string | null;
  checkOut: string | null;
  adults: number | null;
  children: number | null;
  pets: number | null;
  requests: string | null;
}>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RUPEES = 10_000_000;

const textOrNull = (value: unknown, max: number): string | null => {
  const raw = String(value ?? "").trim();
  return raw ? raw.slice(0, max) : null;
};

/** null for "", null or undefined; a whole number in range; otherwise "bad". */
function countOf(value: unknown, max: number): number | null | "bad" {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : "bad";
}

/** Rupees in, paise out. Accepts "21,000", "₹21000", 21000. */
function rupeesToPaise(value: unknown): number | null | "bad" {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) && n > 0 && n <= MAX_RUPEES ? Math.round(n) * 100 : "bad";
}

const has = (body: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(body, key);

/**
 * Reads an edit to an enquiry. Only the keys present are changed; an empty
 * value clears an optional field. Returns the first problem in plain words.
 */
export function parseEnquiryEdit(
  body: Record<string, unknown>,
  normaliseMobile: (raw: string) => string | null,
): { ok: true; fields: EnquiryFieldsPatch; terms: Partial<EnquiryTerms> } | { ok: false; error: string } {
  const fields: EnquiryFieldsPatch = {};
  const terms: Partial<EnquiryTerms> = {};

  if (has(body, "name")) {
    const name = textOrNull(body.name, 200);
    if (!name) return { ok: false, error: "The guest's name cannot be empty." };
    fields.name = name;
  }
  if (has(body, "phone")) {
    const raw = textOrNull(body.phone, 40);
    const phone = raw ? normaliseMobile(raw) : null;
    if (!phone) return { ok: false, error: "That does not look like a mobile number we can reach." };
    fields.phone = phone;
  }
  if (has(body, "email")) fields.email = textOrNull(body.email, 200);

  for (const key of ["checkIn", "checkOut"] as const) {
    if (!has(body, key)) continue;
    const value = textOrNull(body[key], 10);
    if (value !== null && !ISO_DATE.test(value)) return { ok: false, error: "Dates must be YYYY-MM-DD." };
    fields[key] = value;
  }

  for (const [key, max] of [["adults", 50], ["children", 50], ["pets", 10]] as const) {
    if (!has(body, key)) continue;
    const n = countOf(body[key], max);
    if (n === "bad") return { ok: false, error: `Check the number of ${key}.` };
    fields[key] = n;
  }

  if (has(body, "requests")) fields.requests = textOrNull(body.requests, 1000);
  if (has(body, "childrenAges")) terms.childrenAges = textOrNull(body.childrenAges, 100);
  if (has(body, "ownerNote")) terms.ownerNote = textOrNull(body.ownerNote, 1000);
  if (has(body, "priceNote")) terms.priceNote = textOrNull(body.priceNote, 600);

  if (has(body, "agreedTotalRupees")) {
    const total = rupeesToPaise(body.agreedTotalRupees);
    if (total === "bad") return { ok: false, error: "Enter the agreed total in rupees, or leave it empty." };
    terms.agreedTotalPaise = total;
  }
  if (has(body, "agreedAdvanceRupees")) {
    const advance = rupeesToPaise(body.agreedAdvanceRupees);
    if (advance === "bad") return { ok: false, error: "Enter the advance in rupees, or leave it empty." };
    terms.agreedAdvancePaise = advance;
  }

  return { ok: true, fields, terms };
}

/** Both dates set must be in order; checked on the merged result. */
export function datesProblem(checkIn: string | null, checkOut: string | null): string | null {
  if (checkIn && checkOut && checkOut <= checkIn) return "Check-out must be after check-in.";
  return null;
}

/** The agreed advance must fit inside the agreed total. */
export function termsProblem(terms: EnquiryTerms): string | null {
  if (terms.agreedAdvancePaise !== null && terms.agreedTotalPaise === null) return "Set the agreed total before the advance.";
  if (terms.agreedAdvancePaise !== null && terms.agreedTotalPaise !== null && terms.agreedAdvancePaise > terms.agreedTotalPaise) {
    return "The advance cannot be more than the agreed total.";
  }
  return null;
}

/**
 * The quote with the owner's agreed price in place of the rate card.
 *
 * Needs the dates and the party (the guest is told the nights and how many
 * guests the price is for). The rate card's peak rule still decides the
 * usual advance share, unless the owner set his own advance.
 */
export function withAgreedPrice(
  input: { checkIn: string | null; checkOut: string | null; adults: number | null; children: number | null; pets: number | null },
  rateCard: QuoteResult,
  terms: EnquiryTerms,
): QuoteResult & { agreed?: boolean; priceNote?: string | null } {
  if (terms.agreedTotalPaise === null) return rateCard;
  const { checkIn, checkOut } = input;
  if (!checkIn || !checkOut || !ISO_DATE.test(checkIn) || !ISO_DATE.test(checkOut) || checkOut <= checkIn) {
    return { ok: false, reason: "Add the dates to use the agreed price." };
  }
  const breakdown = breakdownOf(input);
  if (breakdown.heads < 1) return { ok: false, reason: "Add the number of guests to use the agreed price." };
  const nights = nightsOf(checkIn, checkOut).length;
  const totalPaise = terms.agreedTotalPaise;
  const advancePercent = rateCard.ok ? rateCard.advancePercent : ADVANCE_PERCENT;
  const advancePaise = terms.agreedAdvancePaise ?? advanceOf(totalPaise, advancePercent);
  return {
    ok: true,
    checkIn,
    checkOut,
    nights,
    guests: breakdown.heads,
    breakdown,
    roomPaise: totalPaise,
    extraGuestPaise: 0,
    petPaise: 0,
    totalPaise,
    advancePaise,
    balancePaise: totalPaise - advancePaise,
    advancePercent: Math.round((advancePaise / totalPaise) * 100),
    // The peak period's full-payment rule gives way to the owner's own advance.
    peak: terms.agreedAdvancePaise === null && rateCard.ok ? rateCard.peak : null,
    agreed: true,
    priceNote: terms.priceNote,
  };
}
