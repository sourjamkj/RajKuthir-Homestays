import { and, asc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import {
  appSettings,
  db,
  enquiries,
  rateOverrides,
  MAX_GUESTS,
  type RateOverride,
} from "@workspace/db";
import {
  DEFAULT_LADDER,
  DEFAULT_PEAKS,
  applyWeeklyDiscount,
  minimumStayFor,
  nightPrice,
  type Ladder,
  type PeakPeriod,
} from "./pricing.ts";

export type RateMode = "fixed" | "percent" | "demand";

export type ResolvedOverride = {
  id: string;
  startDate: string;
  endDate: string;
  label: string | null;
  mode: RateMode;
  /** Effective per-occupancy prices in paise, already resolved for the mode. */
  amounts: Record<string, number>;
  percent: number | null;
  minPercent: number | null;
  maxPercent: number | null;
  demandThreshold: number | null;
  /** demand mode: enquiries counted for these dates, and the uplift they produced. */
  enquiryCount?: number;
  effectivePercent?: number;
};

export type RatePlan = {
  /** Weekday (Sun–Thu) price per occupancy, 1–5. Derived from the ladder. */
  rates: Record<number, number>;
  /** Weekend (Fri–Sat) price per occupancy, 1–5. Derived from the ladder. */
  weekendRates: Record<number, number>;
  ladder: Ladder;
  peaks: PeakPeriod[];
  /** Older percentage / demand / fixed rules. Never apply on peak nights. */
  overrides: ResolvedOverride[];
  maxGuests: number;
};

/** app_settings keys. JSON values, so no table migration was needed. */
const LADDER_KEY = "pricing.ladder";
const PEAKS_KEY = "pricing.peaks";

async function readJsonSetting<T>(key: string): Promise<T | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key));
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

async function writeJsonSetting(key: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value);
  await db
    .insert(appSettings)
    .values({ key, value: text, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: text, updatedAt: new Date() },
    });
}

export async function getLadder(): Promise<Ladder> {
  const saved = await readJsonSetting<Partial<Ladder>>(LADDER_KEY);
  return { ...DEFAULT_LADDER, ...(saved ?? {}) };
}

export async function saveLadder(ladder: Ladder): Promise<void> {
  await writeJsonSetting(LADDER_KEY, ladder);
}

/** Saved peak periods, or the two seeded ones until the owner first saves. */
export async function getPeaks(): Promise<PeakPeriod[]> {
  const saved = await readJsonSetting<PeakPeriod[]>(PEAKS_KEY);
  const peaks = Array.isArray(saved) ? saved : DEFAULT_PEAKS;
  return [...peaks].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export async function savePeaks(peaks: PeakPeriod[]): Promise<void> {
  await writeJsonSetting(PEAKS_KEY, peaks);
}

/** The ladder read out per occupancy, for screens that show a rate card. */
function ladderTable(ladder: Ladder, weekend: boolean): Record<number, number> {
  const base = weekend ? ladder.weekendBasePaise : ladder.weekdayBasePaise;
  const table: Record<number, number> = {};
  for (let guests = 1; guests <= MAX_GUESTS; guests += 1) {
    const extra = Math.max(0, guests - ladder.includedGuests) * ladder.extraGuestPaise;
    table[guests] = Math.max(ladder.floorPaise, base + extra);
  }
  return table;
}

/** How far back enquiries still count as live demand. */
const DEMAND_WINDOW_DAYS = 90;

/** Weekday price per occupancy — kept for callers that want a single card. */
export async function getStandardRates(): Promise<Record<number, number>> {
  return ladderTable(await getLadder(), false);
}

/**
 * Counts enquiries whose requested stay overlaps a period, within the demand
 * window. Overlap rather than containment: someone asking for 20–27 December
 * is expressing interest in a 24–26 peak period even though the dates are not
 * the same.
 */
async function countEnquiriesForPeriod(
  startDate: string,
  endDate: string,
): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - DEMAND_WINDOW_DAYS);

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(enquiries)
    .where(
      and(
        gte(enquiries.createdAt, since),
        isNotNull(enquiries.checkIn),
        isNotNull(enquiries.checkOut),
        // Half-open overlap: starts before our end, ends after our start.
        lt(enquiries.checkIn, endDate),
        sql`${enquiries.checkOut} > ${startDate}`,
      ),
    );

  return row?.count ?? 0;
}

/**
 * Where a period sits between its floor and ceiling uplift, given how many
 * enquiries it has attracted. Linear, capped at the threshold — so demand
 * beyond the threshold does not keep pushing the price up forever.
 */
export function demandPercent(
  minPercent: number,
  maxPercent: number,
  threshold: number,
  enquiryCount: number,
): number {
  const floor = Math.min(minPercent, maxPercent);
  const ceiling = Math.max(minPercent, maxPercent);

  if (threshold <= 0) return ceiling;

  const ratio = Math.min(1, Math.max(0, enquiryCount / threshold));
  return Math.round(floor + (ceiling - floor) * ratio);
}

/**
 * Applies a whole-number percentage uplift to every standard rate.
 *
 * Results are rounded to whole rupees, not paise: a computed ₹5,089.50 reads
 * like a spreadsheet artefact, and nobody quotes a homestay night in paise.
 */
export function applyPercent(
  standard: Record<number, number>,
  percent: number,
): Record<string, number> {
  const result: Record<string, number> = {};

  for (let guests = 1; guests <= MAX_GUESTS; guests += 1) {
    const base = standard[guests];
    if (typeof base === "number") {
      const raised = base * (1 + percent / 100);
      result[String(guests)] = Math.round(raised / 100) * 100;
    }
  }

  return result;
}

async function resolveOverride(
  override: RateOverride,
  standard: Record<number, number>,
): Promise<ResolvedOverride> {
  const shared = {
    id: override.id,
    startDate: override.startDate,
    endDate: override.endDate,
    label: override.label,
    mode: (override.mode ?? "fixed") as RateMode,
    percent: override.percent,
    minPercent: override.minPercent,
    maxPercent: override.maxPercent,
    demandThreshold: override.demandThreshold,
  };

  if (shared.mode === "percent" && typeof override.percent === "number") {
    return {
      ...shared,
      amounts: applyPercent(standard, override.percent),
      effectivePercent: override.percent,
    };
  }

  if (shared.mode === "demand") {
    const min = override.minPercent ?? 0;
    const max = override.maxPercent ?? min;
    const threshold = override.demandThreshold ?? 1;
    const enquiryCount = await countEnquiriesForPeriod(
      override.startDate,
      override.endDate,
    );
    const percent = demandPercent(min, max, threshold, enquiryCount);

    return {
      ...shared,
      amounts: applyPercent(standard, percent),
      enquiryCount,
      effectivePercent: percent,
    };
  }

  return { ...shared, mode: "fixed", amounts: override.amounts ?? {} };
}

/**
 * The full pricing picture. Demand and percentage overrides are resolved to
 * concrete amounts here, so the browser never has to know the rules — it just
 * renders prices, and cannot drift out of step with the server.
 */
export async function getRatePlan(): Promise<RatePlan> {
  const [ladder, peaks, overrides] = await Promise.all([
    getLadder(),
    getPeaks(),
    db.select().from(rateOverrides).orderBy(asc(rateOverrides.startDate)),
  ]);
  const standard = ladderTable(ladder, false);

  return {
    rates: standard,
    weekendRates: ladderTable(ladder, true),
    ladder,
    peaks,
    overrides: await Promise.all(
      overrides.map((override) => resolveOverride(override, standard)),
    ),
    maxGuests: MAX_GUESTS,
  };
}

export async function createOverride(input: {
  startDate: string;
  endDate: string;
  label?: string | null;
  mode: RateMode;
  amounts?: Record<string, number>;
  percent?: number | null;
  minPercent?: number | null;
  maxPercent?: number | null;
  demandThreshold?: number | null;
}): Promise<RateOverride> {
  const [created] = await db
    .insert(rateOverrides)
    .values({
      startDate: input.startDate,
      endDate: input.endDate,
      label: input.label?.trim() || null,
      mode: input.mode,
      amounts: input.amounts ?? {},
      percent: input.percent ?? null,
      minPercent: input.minPercent ?? null,
      maxPercent: input.maxPercent ?? null,
      demandThreshold: input.demandThreshold ?? null,
    })
    .returning();

  return created!;
}

/**
 * Replaces a peak period's settings wholesale. Mode-specific fields for the
 * modes not in use are cleared, so a period switched from demand to percent
 * cannot leave stale min/max values behind to confuse a later reader.
 */
export async function updateOverride(
  id: string,
  input: {
    startDate: string;
    endDate: string;
    label?: string | null;
    mode: RateMode;
    amounts?: Record<string, number>;
    percent?: number | null;
    minPercent?: number | null;
    maxPercent?: number | null;
    demandThreshold?: number | null;
  },
): Promise<RateOverride | null> {
  const [updated] = await db
    .update(rateOverrides)
    .set({
      startDate: input.startDate,
      endDate: input.endDate,
      label: input.label?.trim() || null,
      mode: input.mode,
      amounts: input.mode === "fixed" ? (input.amounts ?? {}) : {},
      percent: input.mode === "percent" ? (input.percent ?? null) : null,
      minPercent: input.mode === "demand" ? (input.minPercent ?? null) : null,
      maxPercent: input.mode === "demand" ? (input.maxPercent ?? null) : null,
      demandThreshold:
        input.mode === "demand" ? (input.demandThreshold ?? null) : null,
    })
    .where(eq(rateOverrides.id, id))
    .returning();

  return updated ?? null;
}

export async function deleteOverride(id: string): Promise<boolean> {
  const deleted = await db
    .delete(rateOverrides)
    .where(eq(rateOverrides.id, id))
    .returning({ id: rateOverrides.id });

  return deleted.length > 0;
}

/**
 * Price for one night at a given occupancy, in paise — the ladder in
 * pricing.ts, with any older rule from rate_overrides applied on non-peak
 * nights (later rules win; a fixed price replaces, a percentage scales), and
 * the floor last.
 */
export function rateForNight(
  plan: RatePlan,
  isoDate: string,
  guests: number,
): number {
  const occupancy = Math.min(
    Math.max(Math.round(guests) || 1, 1),
    plan.maxGuests,
  );

  let adjust: ((price: number) => number) | undefined;
  for (const override of plan.overrides) {
    if (isoDate >= override.startDate && isoDate < override.endDate) {
      const fixed = override.mode === "fixed" ? override.amounts[String(occupancy)] : undefined;
      if (typeof fixed === "number" && fixed > 0) {
        adjust = () => fixed;
      } else if (typeof override.effectivePercent === "number") {
        const percent = override.effectivePercent;
        adjust = (price) => price * (1 + percent / 100);
      }
    }
  }

  return nightPrice(plan.ladder, plan.peaks, isoDate, occupancy, adjust);
}

/** Each night's price for a stay, after the weekly discount. */
export function stayNightPrices(
  plan: RatePlan,
  nights: string[],
  guests: number,
): number[] {
  return applyWeeklyDiscount(
    plan.ladder,
    nights.map((isoDate) => rateForNight(plan, isoDate, guests)),
  );
}

/** The minimum stay a set of nights must meet, if it touches a peak period. */
export function minimumStay(plan: RatePlan, nights: string[]) {
  return minimumStayFor(plan.peaks, nights);
}

/** Total for a stay, counting nights from check-in up to but not including check-out. */
export function totalForStay(
  plan: RatePlan,
  checkIn: string,
  checkOut: string,
  guests: number,
): { nights: number; totalPaise: number } {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { nights: 0, totalPaise: 0 };
  }

  const nights: string[] = [];
  for (let time = start; time < end && nights.length < 366; time += 86_400_000) {
    nights.push(new Date(time).toISOString().slice(0, 10));
  }

  const prices = stayNightPrices(plan, nights, guests);
  return { nights: nights.length, totalPaise: prices.reduce((a, b) => a + b, 0) };
}
