/**
 * The rate ladder: how one night of the villa is priced.
 *
 * Pure — no database, no clock — so every rule here is tested in milliseconds
 * and the browser can mirror it line for line (artifacts/raj-kuthir/src/lib/
 * rates.ts). If you change a rule here, change it there in the same commit.
 *
 *   1. Base: weekday (Sun–Thu nights) or weekend (Fri–Sat nights), for up to
 *      `includedGuests` people.
 *   2. Each guest beyond that, up to `maxGuests`, adds `extraGuestPaise`.
 *   3. A peak period replaces the base with a price tied to the Booking.com
 *      rate for those dates, `discountPercent` below it, and sets a minimum
 *      stay.
 *   4. A stay of `weeklyMinNights` or more takes `weeklyDiscountPercent` off
 *      every night.
 *   5. Nothing — peak, older percentage rules, weekly discount — can take a
 *      night below `floorPaise`. The floor is applied last, every time.
 *
 * Money is paise throughout; computed prices are rounded to whole rupees.
 * Dates are ISO calendar dates; ranges are half-open (end exclusive), the
 * same convention as bookings and the calendar.
 */

export type Ladder = {
  /** Sun–Thu nights, for up to `includedGuests` guests. */
  weekdayBasePaise: number;
  /** Fri and Sat nights, for up to `includedGuests` guests. */
  weekendBasePaise: number;
  /** Guests covered by the base price. */
  includedGuests: number;
  /** Per guest per night beyond `includedGuests`. */
  extraGuestPaise: number;
  /** No night, after any rule or discount, is ever priced below this. */
  floorPaise: number;
  /** Discount for long stays, as a whole percentage. */
  weeklyDiscountPercent: number;
  /** Stays of at least this many nights get the weekly discount. */
  weeklyMinNights: number;
};

export type PeakPeriod = {
  id: string;
  label: string;
  /** First night, inclusive. */
  startDate: string;
  /** Morning after the last night — exclusive, like every range here. */
  endDate: string;
  /**
   * What Booking.com charges per night for these dates (for up to
   * `includedGuests`), entered by the owner. Null until it has been looked
   * up: the nights are then priced at the normal weekday/weekend rate (never
   * a discount off a guess) and the console flags the missing figure. The
   * minimum stay applies either way.
   */
  bookingComPaise: number | null;
  /** How far below the Booking.com rate to price, as a whole percentage. */
  discountPercent: number;
  /** Shortest stay that may include any of these nights. */
  minNights: number;
};

/** Highest occupancy the ladder prices. Parties above it pay party.ts surcharges. */
export const LADDER_MAX_GUESTS = 5;

/** The owner's rate card, October 2026. Used until edited from /admin/rates. */
export const DEFAULT_LADDER: Ladder = {
  weekdayBasePaise: 320_000, // ₹3,200
  weekendBasePaise: 390_000, // ₹3,900
  includedGuests: 2,
  extraGuestPaise: 35_000, // ₹350
  floorPaise: 290_000, // ₹2,900
  weeklyDiscountPercent: 10,
  weeklyMinNights: 7,
};

/** Seeded peak periods. Editable from /admin/rates once saved. */
export const DEFAULT_PEAKS: PeakPeriod[] = [
  {
    id: "poush-mela-new-year-2026",
    label: "Poush Mela, Christmas & New Year",
    startDate: "2026-12-22",
    endDate: "2027-01-02",
    bookingComPaise: null,
    discountPercent: 10,
    minNights: 2,
  },
  {
    id: "basanta-utsav-2027",
    label: "Basanta Utsav",
    startDate: "2027-03-19",
    endDate: "2027-03-23",
    bookingComPaise: null,
    discountPercent: 10,
    minNights: 2,
  },
];

/** Whole rupees, never stray paise. */
export function toWholeRupees(paise: number): number {
  return Math.round(paise / 100) * 100;
}

/** Friday and Saturday nights are the weekend. */
export function isWeekendNight(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 5 || day === 6;
}

function clampOccupancy(guests: number): number {
  return Math.min(Math.max(Math.round(guests) || 1, 1), LADDER_MAX_GUESTS);
}

/** Guests past the base, charged per night. */
export function extraGuestCharge(ladder: Ladder, guests: number): number {
  const extra = Math.max(0, clampOccupancy(guests) - ladder.includedGuests);
  return extra * ladder.extraGuestPaise;
}

/** The peak period covering this night, if any. Later entries win. */
export function peakFor(peaks: PeakPeriod[], isoDate: string): PeakPeriod | null {
  let found: PeakPeriod | null = null;
  for (const peak of peaks) {
    if (isoDate >= peak.startDate && isoDate < peak.endDate) found = peak;
  }
  return found;
}

/** A peak night's base: the Booking.com rate less the discount, or null if not entered. */
export function peakBase(peak: PeakPeriod): number | null {
  if (peak.bookingComPaise === null) return null;
  return toWholeRupees(peak.bookingComPaise * (1 - peak.discountPercent / 100));
}

/**
 * A night before any floor: the peak or weekday/weekend base, plus extra
 * guests. `adjust` lets the older percentage rules in rate_overrides apply
 * on non-peak nights without this file knowing about them.
 */
export function rawNightPrice(
  ladder: Ladder,
  peaks: PeakPeriod[],
  isoDate: string,
  guests: number,
  adjust?: (price: number) => number,
): number {
  const peak = peakFor(peaks, isoDate);
  const peaked = peak ? peakBase(peak) : null;
  if (peaked !== null) return peaked + extraGuestCharge(ladder, guests);

  const base = isWeekendNight(isoDate)
    ? ladder.weekendBasePaise
    : ladder.weekdayBasePaise;
  const price = base + extraGuestCharge(ladder, guests);
  return adjust ? toWholeRupees(adjust(price)) : price;
}

/** The floor, applied last. */
export function withFloor(ladder: Ladder, paise: number): number {
  return Math.max(ladder.floorPaise, paise);
}

/** One night, floor applied. */
export function nightPrice(
  ladder: Ladder,
  peaks: PeakPeriod[],
  isoDate: string,
  guests: number,
  adjust?: (price: number) => number,
): number {
  return withFloor(ladder, rawNightPrice(ladder, peaks, isoDate, guests, adjust));
}

/**
 * Applies the weekly discount to a stay's nightly prices, night by night, so
 * the floor holds on each one rather than only on the average.
 */
export function applyWeeklyDiscount(ladder: Ladder, nightly: number[]): number[] {
  if (nightly.length < ladder.weeklyMinNights || ladder.weeklyDiscountPercent <= 0) {
    return nightly;
  }
  const factor = 1 - ladder.weeklyDiscountPercent / 100;
  return nightly.map((paise) => withFloor(ladder, toWholeRupees(paise * factor)));
}

/**
 * The longest minimum stay among the peak periods a stay touches, or null if
 * it touches none. A stay of 31 Dec – 1 Jan is one night of a two-night peak:
 * refused, with the period named so the guest knows why.
 */
export function minimumStayFor(
  peaks: PeakPeriod[],
  nights: string[],
): { minNights: number; label: string } | null {
  let strictest: { minNights: number; label: string } | null = null;
  for (const isoDate of nights) {
    const peak = peakFor(peaks, isoDate);
    if (peak && (!strictest || peak.minNights > strictest.minNights)) {
      strictest = { minNights: peak.minNights, label: peak.label };
    }
  }
  return strictest;
}

/**
 * Checks a ladder the owner is saving. Returns the problem in words, or null.
 * Kept here so the API and the tests agree on what a valid card is.
 */
export function ladderProblem(ladder: Ladder): string | null {
  const money = [
    ladder.weekdayBasePaise,
    ladder.weekendBasePaise,
    ladder.floorPaise,
  ];
  if (money.some((value) => !Number.isInteger(value) || value <= 0)) {
    return "Weekday, weekend and floor prices must all be set.";
  }
  if (!Number.isInteger(ladder.extraGuestPaise) || ladder.extraGuestPaise < 0) {
    return "The extra-guest charge cannot be negative.";
  }
  if (ladder.weekdayBasePaise < ladder.floorPaise || ladder.weekendBasePaise < ladder.floorPaise) {
    return "The weekday and weekend prices cannot be below the floor.";
  }
  if (
    !Number.isInteger(ladder.weeklyDiscountPercent) ||
    ladder.weeklyDiscountPercent < 0 ||
    ladder.weeklyDiscountPercent > 10
  ) {
    return "The weekly discount must be between 0% and 10%.";
  }
  return null;
}

/** Same, for one peak period. */
export function peakProblem(peak: PeakPeriod): string | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(peak.startDate) || !iso.test(peak.endDate)) {
    return "Choose valid first and last nights.";
  }
  if (peak.endDate <= peak.startDate) {
    return "The last night must be on or after the first night.";
  }
  if (!peak.label.trim()) return "Give the period a name.";
  if (
    peak.bookingComPaise !== null &&
    (!Number.isInteger(peak.bookingComPaise) || peak.bookingComPaise <= 0)
  ) {
    return "The Booking.com rate must be a positive amount.";
  }
  if (!Number.isInteger(peak.discountPercent) || peak.discountPercent < 0 || peak.discountPercent > 50) {
    return "The discount must be between 0% and 50%.";
  }
  if (!Number.isInteger(peak.minNights) || peak.minNights < 1 || peak.minNights > 14) {
    return "The minimum stay must be between 1 and 14 nights.";
  }
  return null;
}
