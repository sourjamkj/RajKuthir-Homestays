import { and, asc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import {
  db,
  enquiries,
  nightlyRates,
  rateOverrides,
  DEFAULT_RATES_PAISE,
  MAX_GUESTS,
  type RateOverride,
} from "@workspace/db";

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
  rates: Record<number, number>;
  overrides: ResolvedOverride[];
  maxGuests: number;
};

/** How far back enquiries still count as live demand. */
const DEMAND_WINDOW_DAYS = 90;

export async function getStandardRates(): Promise<Record<number, number>> {
  const rows = await db
    .select()
    .from(nightlyRates)
    .orderBy(asc(nightlyRates.guests));

  const rates: Record<number, number> = { ...DEFAULT_RATES_PAISE };
  for (const row of rows) {
    if (row.guests >= 1 && row.guests <= MAX_GUESTS) {
      rates[row.guests] = row.amountPaise;
    }
  }

  return rates;
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
  const [standard, overrides] = await Promise.all([
    getStandardRates(),
    db.select().from(rateOverrides).orderBy(asc(rateOverrides.startDate)),
  ]);

  return {
    rates: standard,
    overrides: await Promise.all(
      overrides.map((override) => resolveOverride(override, standard)),
    ),
    maxGuests: MAX_GUESTS,
  };
}

export async function setNightlyRates(
  next: Record<number, number>,
): Promise<void> {
  const entries = Object.entries(next)
    .map(([guests, amountPaise]) => ({
      guests: Number(guests),
      amountPaise,
    }))
    .filter(
      (entry) =>
        Number.isInteger(entry.guests) &&
        entry.guests >= 1 &&
        entry.guests <= MAX_GUESTS &&
        Number.isInteger(entry.amountPaise) &&
        entry.amountPaise > 0,
    );

  if (entries.length === 0) return;

  await db.transaction(async (transaction) => {
    for (const entry of entries) {
      await transaction
        .insert(nightlyRates)
        .values({ ...entry, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: nightlyRates.guests,
          set: { amountPaise: entry.amountPaise, updatedAt: new Date() },
        });
    }
  });
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

export async function deleteOverride(id: string): Promise<boolean> {
  const deleted = await db
    .delete(rateOverrides)
    .where(eq(rateOverrides.id, id))
    .returning({ id: rateOverrides.id });

  return deleted.length > 0;
}

/**
 * Price for one night at a given occupancy, in paise. Later overrides win, so
 * a specific festival range added after a broad seasonal one takes precedence.
 * An override with no price for this occupancy falls through to the standing
 * rate rather than guessing.
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

  let amount: number | null = null;

  for (const override of plan.overrides) {
    if (isoDate >= override.startDate && isoDate < override.endDate) {
      const candidate = override.amounts[String(occupancy)];
      if (typeof candidate === "number" && candidate > 0) amount = candidate;
    }
  }

  return amount ?? plan.rates[occupancy] ?? DEFAULT_RATES_PAISE[occupancy] ?? 0;
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

  let nights = 0;
  let totalPaise = 0;

  for (let time = start; time < end; time += 86_400_000) {
    const iso = new Date(time).toISOString().slice(0, 10);
    totalPaise += rateForNight(plan, iso, guests);
    nights += 1;
    if (nights > 366) break;
  }

  return { nights, totalPaise };
}
