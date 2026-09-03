import {
  pgTable,
  date,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Per-night pricing, which at Sobuj Potro varies by **occupancy**, not by
 * weekday: one guest pays less than five for the same night in the same villa.
 *
 * `nightly_rates` holds the standing price for each guest count.
 * `rate_overrides` holds the exceptions — Poush Mela, New Year, a festival
 * week — as a date range carrying its own full set of per-guest prices.
 *
 * Money is in PAISE (integer), matching the bookings ledger. Never rupee
 * floats: they drift once summed.
 *
 * Dates follow the same half-open convention as `calendar_events` and
 * `bookings`: `startDate` inclusive, `endDate` exclusive.
 */

export const nightlyRates = pgTable("nightly_rates", {
  /** Number of guests this price applies to. */
  guests: integer("guests").primaryKey(),
  amountPaise: integer("amount_paise").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type NightlyRate = typeof nightlyRates.$inferSelect;

export const rateOverrides = pgTable(
  "rate_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    label: text("label"),
    /**
     * Per-guest prices for this period, in paise, keyed by guest count as a
     * string: {"1": 300000, "2": 350000, ...}. Stored as one object rather
     * than a row per occupancy so a peak period stays a single thing the
     * owner can edit or delete as a unit.
     */
    amounts: jsonb("amounts").$type<Record<string, number>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("rate_override_range_idx").on(table.startDate, table.endDate),
  ],
);

export type RateOverride = typeof rateOverrides.$inferSelect;

/** Highest occupancy the villa is priced for. */
export const MAX_GUESTS = 5;

/**
 * Fallback prices, used until the owner saves their own. These are the real
 * standing rates for the two-bedroom villa.
 */
export const DEFAULT_RATES_PAISE: Record<number, number> = {
  1: 261_000,
  2: 290_000,
  3: 319_000,
  4: 377_000,
  5: 391_500,
};
