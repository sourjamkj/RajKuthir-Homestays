import {
  pgTable,
  pgEnum,
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

/**
 * How a peak period sets its prices.
 *
 * - `fixed`   exact rupee amounts per occupancy
 * - `percent` a flat uplift over the standard rates
 * - `demand`  an uplift that climbs from minPercent to maxPercent as enquiries
 *             for those dates come in — priced by interest, not by guesswork
 */
export const rateModeEnum = pgEnum("rate_mode", ["fixed", "percent", "demand"]);

export const rateOverrides = pgTable(
  "rate_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    label: text("label"),

    mode: rateModeEnum("mode").notNull().default("fixed"),

    /**
     * `fixed` mode only: per-guest prices in paise, keyed by guest count as a
     * string — {"1": 300000, "2": 350000, ...}. Stored as one object rather
     * than a row per occupancy so a peak period stays a single thing the
     * owner can edit or delete as a unit. Empty for the other two modes.
     */
    amounts: jsonb("amounts").$type<Record<string, number>>().notNull(),

    /** `percent` mode: whole-number uplift over standard rates, e.g. 30 = +30%. */
    percent: integer("percent"),

    /** `demand` mode: the uplift floor and ceiling, as whole percentages. */
    minPercent: integer("min_percent"),
    maxPercent: integer("max_percent"),

    /**
     * `demand` mode: the number of enquiries for these dates at which the
     * uplift reaches maxPercent. Below it the price scales linearly from
     * minPercent, so a quiet period never charges the ceiling.
     */
    demandThreshold: integer("demand_threshold"),
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
