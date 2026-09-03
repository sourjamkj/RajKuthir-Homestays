import { useQuery } from '@tanstack/react-query';

/**
 * Nightly pricing, shared by the public availability calendar and the owner
 * console. Prices vary by occupancy, not by weekday.
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

export type RatePlan = {
  rates: Record<string, number>;
  overrides: RateOverride[];
  maxGuests: number;
};

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

/**
 * Price for one night at a given occupancy, in paise. Later overrides win, so
 * a specific festival range added after a broad seasonal one takes precedence.
 * An override with no price for this occupancy falls through to the standing
 * rate rather than guessing.
 */
export function rateForNight(
  plan: RatePlan | undefined,
  isoDate: string,
  guests: number,
): number | null {
  if (!plan) return null;

  const occupancy = clampGuests(plan, guests);
  let amount: number | null = null;

  for (const override of plan.overrides) {
    if (isoDate >= override.startDate && isoDate < override.endDate) {
      const candidate = override.amounts[String(occupancy)];
      if (typeof candidate === 'number' && candidate > 0) amount = candidate;
    }
  }

  if (amount !== null) return amount;

  const standing = plan.rates[String(occupancy)];
  return typeof standing === 'number' ? standing : null;
}

/** True when this night is priced by an override rather than the standing rate. */
export function isPeakNight(
  plan: RatePlan | undefined,
  isoDate: string,
): boolean {
  if (!plan) return false;

  return plan.overrides.some(
    (override) => isoDate >= override.startDate && isoDate < override.endDate,
  );
}

/**
 * Total for a stay, counting nights from check-in up to but not including
 * check-out — a Friday-to-Sunday stay is two nights.
 */
export function totalForStay(
  plan: RatePlan | undefined,
  checkIn: string,
  checkOut: string,
  guests: number,
): { nights: number; totalPaise: number } {
  if (!plan || !checkIn || !checkOut) return { nights: 0, totalPaise: 0 };

  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { nights: 0, totalPaise: 0 };
  }

  let nights = 0;
  let totalPaise = 0;

  for (let time = start; time < end; time += 86_400_000) {
    const iso = new Date(time).toISOString().slice(0, 10);
    totalPaise += rateForNight(plan, iso, guests) ?? 0;
    nights += 1;
    if (nights > 366) break;
  }

  return { nights, totalPaise };
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
