/**
 * Turning an enquiry into a price.
 *
 * An enquiry is what a stranger typed into a form; a quote is a number we are
 * willing to be held to. Everything awkward in between lives here: missing
 * dates, a check-out before the check-in, an occupancy nobody has priced.
 *
 * Nothing in this file reads the database or the clock. The pricing itself is
 * injected as `priceStay`, which in production is `totalForStay` bound to the
 * live rate plan — so the whole of the money logic can be tested against a
 * handful of made-up rates in milliseconds.
 *
 * The rule throughout: when a quote cannot be produced honestly, return the
 * reason instead of a number. A wrong price sent to a guest over WhatsApp is
 * not a bug you get to take back.
 */

/** How much of the total is asked for up front, the balance at check-in. */
export const ADVANCE_PERCENT = 50;

export type QuoteInput = {
  checkIn: string | null;
  checkOut: string | null;
  adults: number | null;
  children: number | null;
};

export type PriceStay = (
  checkIn: string,
  checkOut: string,
  guests: number,
) => { nights: number; totalPaise: number };

export type Quote = {
  checkIn: string;
  checkOut: string;
  nights: number;
  /** Heads the price was calculated for: adults plus children. */
  guests: number;
  totalPaise: number;
  advancePaise: number;
  balancePaise: number;
};

export type QuoteResult =
  | ({ ok: true } & Quote)
  | { ok: false; reason: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

/**
 * Children count towards occupancy.
 *
 * Sobuj Potro prices by heads in beds rather than by age, so a family of two
 * adults and two children is priced as four. If that ever stops being true,
 * this one line is the place it changes — not six call sites.
 */
function headcount(input: QuoteInput): number {
  return (input.adults ?? 0) + (input.children ?? 0);
}

export function quoteForEnquiry(
  input: QuoteInput,
  priceStay: PriceStay,
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

  const guests = headcount(input);

  if (guests < 1) {
    // Occupancy is the whole basis of the price here, so guessing "probably
    // two" would be inventing the number the guest is asked to pay.
    return { ok: false, reason: "No guest count on this enquiry." };
  }

  const { nights, totalPaise } = priceStay(checkIn, checkOut, guests);

  if (nights < 1) {
    return { ok: false, reason: "That date range is not a stay." };
  }

  if (totalPaise <= 0) {
    return {
      ok: false,
      reason: `No rate is set for ${guests} guest${guests === 1 ? "" : "s"}.`,
    };
  }

  const advancePaise = advanceOf(totalPaise);

  return {
    ok: true,
    checkIn,
    checkOut,
    nights,
    guests,
    totalPaise,
    advancePaise,
    balancePaise: totalPaise - advancePaise,
  };
}
