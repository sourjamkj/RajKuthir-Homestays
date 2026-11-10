import { extraGuestCharge, ladderProblem, peakBase, peakNightPrice, peakProblem, withFloor, type Ladder, type PeakPeriod } from "./pricing.ts";

/**
 * Rate changes made through the Claude connector: work out the new ladder or
 * peak period from what the owner asked, and show the guest-facing prices
 * before and after, so nothing is saved that the owner has not seen. Pure:
 * the same validators as the console (ladderProblem, peakProblem).
 */

export const OCCUPANCIES = [1, 2, 3, 4, 5] as const;
const MAX_RUPEES = 1_000_000;

const rupeeText = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

function paiseOf(rupees: number | undefined, { allowZero = false } = {}): number | undefined | "bad" {
  if (rupees === undefined) return undefined;
  if (!Number.isFinite(rupees) || rupees > MAX_RUPEES || rupees < 0 || (!allowZero && rupees === 0)) return "bad";
  return Math.round(rupees) * 100;
}

/** "1 guest: ₹2,900" … "5 guests: ₹3,500" for one kind of night. */
function row(price: (guests: number) => number): Record<string, string> {
  return Object.fromEntries(OCCUPANCIES.map((n) => [`${n} guest${n === 1 ? "" : "s"}`, rupeeText(price(n))]));
}

/** What a normal night costs by party size, weekday and Friday/Saturday. */
export function ladderTable(ladder: Ladder) {
  return {
    "Sun–Thu": row((n) => withFloor(ladder, ladder.weekdayBasePaise + extraGuestCharge(ladder, n))),
    "Fri–Sat": row((n) => withFloor(ladder, ladder.weekendBasePaise + extraGuestCharge(ladder, n))),
    floor: rupeeText(ladder.floorPaise),
    weeklyDiscount: `${ladder.weeklyDiscountPercent}% from ${ladder.weeklyMinNights} nights`,
  };
}

/** What a peak night costs by party size. */
export function peakTable(peak: PeakPeriod, ladder: Ladder) {
  const base = peakBase(peak);
  const lastNight = new Date(`${peak.endDate}T00:00:00Z`);
  lastNight.setUTCDate(lastNight.getUTCDate() - 1);
  return {
    id: peak.id,
    label: peak.label,
    nights: `${peak.startDate} to ${lastNight.toISOString().slice(0, 10)} (both included)`,
    minNights: peak.minNights,
    bookingComReference: peak.bookingComPaise === null ? "not entered" : `${rupeeText(peak.bookingComPaise)} less ${peak.discountPercent}%`,
    prices: base === null ? "no Booking.com rate: priced as normal nights" : row(() => withFloor(ladder, peakNightPrice(peak, ladder)!)),
  };
}

export type LadderArgs = {
  weekdayBaseRupees?: number;
  weekendBaseRupees?: number;
  extraGuestRupees?: number;
  floorRupees?: number;
  weeklyDiscountPercent?: number;
};

export function nextLadder(current: Ladder, args: LadderArgs): { ok: true; ladder: Ladder } | { ok: false; error: string } {
  const weekday = paiseOf(args.weekdayBaseRupees);
  const weekend = paiseOf(args.weekendBaseRupees);
  const extra = paiseOf(args.extraGuestRupees, { allowZero: true });
  const floor = paiseOf(args.floorRupees);
  if ([weekday, weekend, extra, floor].includes("bad")) return { ok: false, error: "Amounts must be whole rupees above zero." };
  const ladder: Ladder = {
    ...current,
    weekdayBasePaise: (weekday as number | undefined) ?? current.weekdayBasePaise,
    weekendBasePaise: (weekend as number | undefined) ?? current.weekendBasePaise,
    extraGuestPaise: (extra as number | undefined) ?? current.extraGuestPaise,
    floorPaise: (floor as number | undefined) ?? current.floorPaise,
    weeklyDiscountPercent: args.weeklyDiscountPercent === undefined ? current.weeklyDiscountPercent : Math.round(args.weeklyDiscountPercent),
  };
  const problem = ladderProblem(ladder);
  return problem ? { ok: false, error: problem } : { ok: true, ladder };
}

export type PeakArgs = {
  label?: string;
  firstNight?: string;
  lastNight?: string;
  /** The direct price for a full house (5 guests) on these nights; the Booking.com reference is worked back from it. */
  priceFor5GuestsRupees?: number;
  bookingComRupees?: number;
  discountPercent?: number;
  minNights?: number;
};

const dayAfter = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * A new or changed peak period. With priceFor5GuestsRupees the Booking.com
 * reference is set so the site lands exactly on that price (peak base +
 * the usual extra-guest steps), keeping the existing discount.
 */
export function nextPeak(
  existing: PeakPeriod | null,
  args: PeakArgs,
  ladder: Ladder,
  id: string,
): { ok: true; peak: PeakPeriod } | { ok: false; error: string } {
  if (!existing && (!args.firstNight || !args.lastNight || !args.label)) {
    return { ok: false, error: "A new peak period needs a label, firstNight and lastNight." };
  }
  if (args.lastNight && args.firstNight && args.lastNight < args.firstNight) return { ok: false, error: "The last night is before the first night." };

  const discountPercent = args.discountPercent === undefined ? (existing?.discountPercent ?? 10) : Math.round(args.discountPercent);
  let bookingComPaise = existing?.bookingComPaise ?? null;
  if (args.bookingComRupees !== undefined) {
    const paise = paiseOf(args.bookingComRupees);
    if (paise === "bad" || paise === undefined) return { ok: false, error: "The Booking.com rate must be whole rupees above zero." };
    bookingComPaise = paise;
  }
  if (args.priceFor5GuestsRupees !== undefined) {
    const target = paiseOf(args.priceFor5GuestsRupees);
    if (target === "bad" || target === undefined) return { ok: false, error: "The price must be whole rupees above zero." };
    const base = target - extraGuestCharge(ladder, 5);
    if (base <= 0) return { ok: false, error: "That price is below the extra-guest charges alone." };
    if (discountPercent >= 100) return { ok: false, error: "The discount must be below 100%." };
    // Work the reference back to the rupee, then nudge until the site's own rounding lands on the base exactly.
    const start = Math.round(base / (1 - discountPercent / 100) / 100) * 100;
    const found = [0, 100, -100, 200, -200, 300, -300].map((d) => start + d).find((ref) => peakBase({ bookingComPaise: ref, discountPercent } as PeakPeriod) === base);
    if (found === undefined) return { ok: false, error: `No Booking.com reference at ${discountPercent}% off gives exactly that price; try another discount.` };
    bookingComPaise = found;
  }

  const startDate = args.firstNight ?? existing!.startDate;
  const endDate = args.lastNight ? dayAfter(args.lastNight) : existing!.endDate;
  const peak: PeakPeriod = {
    id,
    label: (args.label ?? existing?.label ?? "").slice(0, 120).trim(),
    startDate,
    endDate,
    bookingComPaise,
    discountPercent,
    minNights: args.minNights === undefined ? (existing?.minNights ?? 2) : Math.round(args.minNights),
  };
  const problem = peakProblem(peak);
  return problem ? { ok: false, error: problem } : { ok: true, peak };
}
