import {
  breakdownOf,
  petCharge,
  stayTotalPaise,
  surchargePerNight,
  type Party,
  type PartyBreakdown,
} from "./party.ts";

/**
 * Turning an enquiry into a price.
 *
 * An enquiry is what a stranger typed into a form; a quote is a number we are
 * willing to be held to. Everything awkward in between lives here: missing
 * dates, a check-out before the check-in, an occupancy nobody has priced.
 *
 * Nothing in this file reads the database or the clock. The nightly rate is
 * injected as `nightlyRate`, which in production is `rateForNight` bound to
 * the live plan — so the whole of the money logic can be tested against a
 * handful of made-up rates in milliseconds. Who is in the party, and what
 * that adds, is party.ts; this file is about the stay.
 *
 * The rule throughout: when a quote cannot be produced honestly, return the
 * reason instead of a number. A wrong price sent to a guest over WhatsApp is
 * not a bug you get to take back.
 */

/** How much of the total is asked for up front, the balance at check-in. */
export const ADVANCE_PERCENT = 50;

export type QuoteInput = Party & {
  checkIn: string | null;
  checkOut: string | null;
};

/** The standing price for one night at a given occupancy, in paise. */
export type NightlyRate = (isoDate: string, guests: number) => number;

export type Quote = {
  checkIn: string;
  checkOut: string;
  nights: number;
  /** Everyone sleeping here, children included. */
  guests: number;
  breakdown: PartyBreakdown;
  /** The nights themselves, before extra heads and pets. */
  roomPaise: number;
  /** Extra heads, across the whole stay. */
  extraGuestPaise: number;
  /** Pets, charged once. */
  petPaise: number;
  totalPaise: number;
  advancePaise: number;
  balancePaise: number;
};

export type QuoteResult =
  | ({ ok: true } & Quote)
  | { ok: false; reason: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * Every night of a stay, check-in included and check-out excluded — the same
 * half-open convention the calendar and the bookings ledger already use.
 * Capped, so a typo in a year cannot walk a loop for a decade.
 */
export function nightsOf(checkIn: string, checkOut: string): string[] {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return [];
  }

  const nights: string[] = [];
  for (let time = start; time < end && nights.length < 366; time += DAY_MS) {
    nights.push(new Date(time).toISOString().slice(0, 10));
  }

  return nights;
}

/**
 * The advance, rounded up to a whole rupee.
 *
 * Half of an odd total lands on a half-paise amount, and "please send
 * ₹7,499.50" reads like a phishing message. Rounding up rather than to
 * nearest keeps the balance honest: the guest is never asked for more in
 * total than the stay costs, because the balance is whatever is left.
 */
export function advanceOf(totalPaise: number): number {
  const half = (totalPaise * ADVANCE_PERCENT) / 100;
  return Math.ceil(half / 100) * 100;
}

export function quoteForEnquiry(
  input: QuoteInput,
  nightlyRate: NightlyRate,
): QuoteResult {
  const { checkIn, checkOut } = input;

  if (!checkIn || !checkOut) {
    return { ok: false, reason: "No dates on this enquiry." };
  }

  if (!ISO_DATE.test(checkIn) || !ISO_DATE.test(checkOut)) {
    return { ok: false, reason: "The dates on this enquiry are not readable." };
  }

  if (checkOut <= checkIn) {
    return { ok: false, reason: "Check-out is not after check-in." };
  }

  const breakdown = breakdownOf(input);

  if (breakdown.heads < 1) {
    // Occupancy is the whole basis of the price here, so guessing "probably
    // two" would be inventing the number the guest is asked to pay.
    return { ok: false, reason: "No guest count on this enquiry." };
  }

  const nights = nightsOf(checkIn, checkOut);

  if (nights.length < 1) {
    return { ok: false, reason: "That date range is not a stay." };
  }

  const roomPaise = nights.reduce(
    (total, isoDate) => total + nightlyRate(isoDate, breakdown.ratedGuests),
    0,
  );

  if (roomPaise <= 0) {
    return {
      ok: false,
      reason: `No rate is set for ${breakdown.ratedGuests} guest${breakdown.ratedGuests === 1 ? "" : "s"}.`,
    };
  }

  const totalPaise = stayTotalPaise({ nights, breakdown, nightlyRate });
  const advancePaise = advanceOf(totalPaise);

  return {
    ok: true,
    checkIn,
    checkOut,
    nights: nights.length,
    guests: breakdown.heads,
    breakdown,
    roomPaise,
    extraGuestPaise: surchargePerNight(breakdown) * nights.length,
    petPaise: petCharge(breakdown),
    totalPaise,
    advancePaise,
    balancePaise: totalPaise - advancePaise,
  };
}
