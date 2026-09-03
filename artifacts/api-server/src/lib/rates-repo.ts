import { asc, eq } from "drizzle-orm";
import {
  db,
  nightlyRates,
  rateOverrides,
  DEFAULT_RATES_PAISE,
  MAX_GUESTS,
  type RateOverride,
} from "@workspace/db";

export type RatePlan = {
  /** Standing price per guest count, in paise, keyed by guest count. */
  rates: Record<number, number>;
  overrides: Array<{
    id: string;
    startDate: string;
    endDate: string;
    label: string | null;
    amounts: Record<string, number>;
  }>;
  maxGuests: number;
};

export async function getRatePlan(): Promise<RatePlan> {
  const [rows, overrides] = await Promise.all([
    db.select().from(nightlyRates).orderBy(asc(nightlyRates.guests)),
    db.select().from(rateOverrides).orderBy(asc(rateOverrides.startDate)),
  ]);

  const rates: Record<number, number> = { ...DEFAULT_RATES_PAISE };
  for (const row of rows) {
    if (row.guests >= 1 && row.guests <= MAX_GUESTS) {
      rates[row.guests] = row.amountPaise;
    }
  }

  return {
    rates,
    overrides: overrides.map((override) => ({
      id: override.id,
      startDate: override.startDate,
      endDate: override.endDate,
      label: override.label,
      amounts: override.amounts ?? {},
    })),
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
  amounts: Record<string, number>;
}): Promise<RateOverride> {
  const [created] = await db
    .insert(rateOverrides)
    .values({
      startDate: input.startDate,
      endDate: input.endDate,
      label: input.label?.trim() || null,
      amounts: input.amounts,
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
 * Price for one night at a given occupancy, in paise.
 *
 * Later overrides win over earlier ones, so a specific festival range added
 * after a broad seasonal range takes precedence. An override that has no entry
 * for this occupancy falls through to the standing rate rather than guessing.
 */
export function rateForNight(
  plan: RatePlan,
  isoDate: string,
  guests: number,
): number {
  const occupancy = Math.min(Math.max(Math.round(guests) || 1, 1), plan.maxGuests);

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
