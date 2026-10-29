import { useQuery } from '@tanstack/react-query';

/**
 * Nightly pricing, shared by the public availability calendar and the owner
 * console. A weekday/weekend ladder by occupancy, peak periods tied to the
 * Booking.com rate, a weekly discount and a hard floor — see pricing.ts.
 *
 * The resolution rules mirror the server's `rateForNight` exactly — if you
 * change one, change the other. Money is in paise throughout; format at the
 * point of display.
 */

export const RATES_KEY = ['/api/rates'];

export type RateMode = 'fixed' | 'percent' | 'demand';

export type RateOverride = {
  id: string;
  startDate: string;
  endDate: string;
  label: string | null;
  mode: RateMode;
  /**
   * Effective prices in paise, already resolved by the server for whichever
   * mode this period uses. The browser never recomputes a percentage or a
   * demand curve — that way the two can't disagree about what a night costs.
   */
  amounts: Record<string, number>;
  percent: number | null;
  minPercent: number | null;
  maxPercent: number | null;
  demandThreshold: number | null;
  /** demand mode only: what the server counted and what uplift it produced. */
  enquiryCount?: number;
  effectivePercent?: number;
};

/**
 * What extra heads and pets cost, sent with the plan rather than hard-coded
 * here. One source for these numbers means the page cannot advertise ₹500
 * while the server charges ₹550 — which is worse than saying nothing at all.
 */
export type RateExtras = {
  /** Under this age a guest is charged the child rate for an extra head. */
  childUnderAge: number;
  extraAdultPaise: number;
  extraChildPaise: number;
  /** Per pet for a stay of one or two nights, once for the stay. */
  petPaise: number;
  /** Per pet per night once the stay reaches petNightlyFromNights. */
  petNightlyPaise?: number;
  petNightlyFromNights?: number;
};

/** Mirrors the server's pricing.ts Ladder. */
export type Ladder = {
  weekdayBasePaise: number;
  weekendBasePaise: number;
  includedGuests: number;
  extraGuestPaise: number;
  floorPaise: number;
  weeklyDiscountPercent: number;
  weeklyMinNights: number;
};

/** Mirrors the server's pricing.ts PeakPeriod. endDate is exclusive. */
export type PeakPeriod = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  bookingComPaise: number | null;
  discountPercent: number;
  minNights: number;
};

export type RatePlan = {
  /** Weekday (Sun–Thu) price per occupancy. */
  rates: Record<string, number>;
  /** Weekend (Fri–Sat) price per occupancy. */
  weekendRates?: Record<string, number>;
  ladder?: Ladder;
  peaks?: PeakPeriod[];
  overrides: RateOverride[];
  maxGuests: number;
  extras?: RateExtras;
};

export type Party = { adults: number; children: number; pets: number };

export type PartyBreakdown = {
  heads: number;
  ratedGuests: number;
  extraChildren: number;
  extraAdults: number;
  pets: number;
};

/**
 * Mirrors the server's party.ts. A child counts as a guest: two adults and
 * two children are a party of four at the four-guest rate, with nothing
 * added. The per-child charge is what an extra head costs once the party is
 * larger than the rate card goes — never a fee for bringing a child.
 */
export function breakdownOf(plan: RatePlan | undefined, party: Party): PartyBreakdown {
  const cap = plan?.maxGuests ?? 5;
  const adults = Math.max(0, Math.floor(party.adults));
  const children = Math.max(0, Math.floor(party.children));
  const heads = adults + children;
  const overflow = Math.max(0, heads - cap);

  // Children take the cheaper surcharge first.
  const extraChildren = Math.min(children, overflow);

  return {
    heads,
    ratedGuests: Math.min(heads, cap),
    extraChildren,
    extraAdults: overflow - extraChildren,
    pets: Math.max(0, Math.floor(party.pets)),
  };
}

export function surchargePerNight(
  plan: RatePlan | undefined,
  breakdown: PartyBreakdown,
): number {
  const extras = plan?.extras;
  if (!extras) return 0;

  return (
    breakdown.extraChildren * extras.extraChildPaise +
    breakdown.extraAdults * extras.extraAdultPaise
  );
}

/** Pets: a flat charge each for one or two nights; per night each from three. Mirrors party.ts. */
export function petCharge(
  plan: RatePlan | undefined,
  breakdown: PartyBreakdown,
  nights: number,
): number {
  const extras = plan?.extras;
  if (!extras || breakdown.pets <= 0 || nights <= 0) return 0;
  const from = extras.petNightlyFromNights ?? Infinity;
  const perPet = nights >= from && extras.petNightlyPaise ? extras.petNightlyPaise * nights : extras.petPaise;
  return breakdown.pets * perPet;
}

/** The pet charge in words, from the plan — the same sentence as the server's chargesNote. */
export function petChargeText(extras: RateExtras, format: (paise: number) => string): string {
  if (!extras.petNightlyPaise || !extras.petNightlyFromNights) return `Pets are ${format(extras.petPaise)} each for the stay.`;
  return `Pets are ${format(extras.petPaise)} each for a stay of one or two nights; from ${extras.petNightlyFromNights} nights, ${format(extras.petNightlyPaise)} each per night.`;
}

/** What one night costs this party: the rate card plus any extra heads. */
export function nightlyForParty(
  plan: RatePlan | undefined,
  isoDate: string,
  party: Party,
): number | null {
  const breakdown = breakdownOf(plan, party);
  const base = rateForNight(plan, isoDate, breakdown.ratedGuests);
  if (base === null) return null;

  return base + surchargePerNight(plan, breakdown);
}

/**
 * `/api/rates` is public and carries `Cache-Control: max-age=300`, which is
 * right for guests — every visitor hits it and the prices rarely move.
 *
 * It is wrong for the owner console. After saving a peak period the browser
 * would serve its own cached copy back to the refetch, and the change would
 * appear not to have happened at all. Admin screens therefore pass
 * `fresh: true`, which bypasses the HTTP cache for that request only.
 */
export function useRatePlan(options?: { fresh?: boolean }) {
  const fresh = options?.fresh === true;

  return useQuery({
    queryKey: fresh ? [...RATES_KEY, 'fresh'] : RATES_KEY,
    queryFn: async (): Promise<RatePlan> => {
      const response = await fetch(
        '/api/rates',
        fresh ? { cache: 'no-store' } : undefined,
      );
      if (!response.ok) throw new Error('Could not load rates.');
      return response.json();
    },
    staleTime: fresh ? 0 : 5 * 60_000,
    retry: false,
  });
}

function clampGuests(plan: RatePlan, guests: number): number {
  const max = plan.maxGuests || 5;
  return Math.min(Math.max(Math.round(guests) || 1, 1), max);
}

const wholeRupees = (paise: number) => Math.round(paise / 100) * 100;

/** Friday and Saturday nights are the weekend. */
export function isWeekendNight(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 5 || day === 6;
}

/** The peak period covering this night, if any. Later entries win. */
export function peakFor(plan: RatePlan | undefined, isoDate: string): PeakPeriod | null {
  let found: PeakPeriod | null = null;
  for (const peak of plan?.peaks ?? []) {
    if (isoDate >= peak.startDate && isoDate < peak.endDate) found = peak;
  }
  return found;
}

/**
 * Price for one night at a given occupancy, in paise. Mirrors the server's
 * rateForNight + pricing.ts exactly — change both together:
 * peak (Booking.com rate less its discount) or weekday/weekend base, plus
 * extra guests past the base; older rate rules on non-peak nights; floor last.
 */
export function rateForNight(
  plan: RatePlan | undefined,
  isoDate: string,
  guests: number,
): number | null {
  if (!plan) return null;
  const occupancy = clampGuests(plan, guests);
  const ladder = plan.ladder;

  // An older server without the ladder: read the occupancy card as before.
  if (!ladder) {
    const standing = plan.rates[String(occupancy)];
    return typeof standing === 'number' ? standing : null;
  }

  const extra = Math.max(0, occupancy - ladder.includedGuests) * ladder.extraGuestPaise;
  const peak = peakFor(plan, isoDate);

  let price: number;
  if (peak && peak.bookingComPaise !== null) {
    price = wholeRupees(peak.bookingComPaise * (1 - peak.discountPercent / 100)) + extra;
  } else {
    price = (isWeekendNight(isoDate) ? ladder.weekendBasePaise : ladder.weekdayBasePaise) + extra;
    if (!peak) {
      let adjusted: number | null = null;
      for (const override of plan.overrides) {
        if (isoDate >= override.startDate && isoDate < override.endDate) {
          const fixed = override.mode === 'fixed' ? override.amounts[String(occupancy)] : undefined;
          if (typeof fixed === 'number' && fixed > 0) adjusted = fixed;
          else if (typeof override.effectivePercent === 'number') {
            adjusted = wholeRupees(price * (1 + override.effectivePercent / 100));
          }
        }
      }
      if (adjusted !== null) price = adjusted;
    }
  }

  return Math.max(ladder.floorPaise, price);
}

/** Weekly discount, night by night so the floor holds on each. */
export function applyWeeklyDiscount(plan: RatePlan | undefined, nightly: number[]): number[] {
  const ladder = plan?.ladder;
  if (!ladder || nightly.length < ladder.weeklyMinNights || ladder.weeklyDiscountPercent <= 0) {
    return nightly;
  }
  const factor = 1 - ladder.weeklyDiscountPercent / 100;
  return nightly.map((paise) => Math.max(ladder.floorPaise, wholeRupees(paise * factor)));
}

function nightsBetween(checkIn: string, checkOut: string): string[] {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const nights: string[] = [];
  for (let time = start; time < end && nights.length < 366; time += 86_400_000) {
    nights.push(new Date(time).toISOString().slice(0, 10));
  }
  return nights;
}

/** The strictest peak minimum stay a date range touches, or null. */
export function minimumStayFor(
  plan: RatePlan | undefined,
  checkIn: string,
  checkOut: string,
): { minNights: number; label: string } | null {
  let strictest: { minNights: number; label: string } | null = null;
  for (const isoDate of nightsBetween(checkIn, checkOut)) {
    const peak = peakFor(plan, isoDate);
    if (peak && (!strictest || peak.minNights > strictest.minNights)) {
      strictest = { minNights: peak.minNights, label: peak.label };
    }
  }
  return strictest;
}

/** True when this night is in a peak period or an older price rule. */
export function isPeakNight(
  plan: RatePlan | undefined,
  isoDate: string,
): boolean {
  if (!plan) return false;
  if (peakFor(plan, isoDate)) return true;
  return plan.overrides.some(
    (override) => isoDate >= override.startDate && isoDate < override.endDate,
  );
}

/**
 * Total for a stay, counting nights from check-in up to but not including
 * check-out — a Friday-to-Sunday stay is two nights. Weekly discount applied.
 */
export function totalForStay(
  plan: RatePlan | undefined,
  checkIn: string,
  checkOut: string,
  guests: number,
): { nights: number; totalPaise: number; discounted: boolean } {
  if (!plan || !checkIn || !checkOut) return { nights: 0, totalPaise: 0, discounted: false };
  const nights = nightsBetween(checkIn, checkOut);
  const full = nights.map((isoDate) => rateForNight(plan, isoDate, guests) ?? 0);
  const prices = applyWeeklyDiscount(plan, full);
  const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
  return {
    nights: nights.length,
    totalPaise: sum(prices),
    discounted: sum(prices) < sum(full),
  };
}

/** Full amount, e.g. ₹2,610 — used in the booking summary. */
export const formatRupees = (paise: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);

/**
 * Compact form for calendar cells, where space is tight: ₹2.6K, ₹12K, ₹950.
 * Mirrors how Airbnb shows prices in its month grid.
 */
export function formatRupeesCompact(paise: number): string {
  const rupees = paise / 100;
  if (rupees < 1000) return `₹${Math.round(rupees)}`;

  const thousands = rupees / 1000;
  const rounded =
    thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10;

  return `₹${rounded}K`;
}
