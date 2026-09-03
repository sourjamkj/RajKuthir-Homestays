import {
  pgTable,
  pgEnum,
  date,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { calendarSourceEnum } from "./calendar";

/**
 * The booking and money ledger.
 *
 * MONEY IS STORED IN PAISE, always as an integer. Rupee floats accumulate
 * rounding error once you start summing them for a monthly total, and OTA
 * payouts genuinely carry paise (Airbnb deducts amounts like ₹4,581.36).
 * Convert at the edges only — `toPaise` / `toRupees` in the repo are the one
 * place that should ever do it.
 */

export const bookingStatusEnum = pgEnum("booking_status", [
  "pending",
  "confirmed",
  "cancelled",
]);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Which channel it came through. `manual` covers walk-ins and offline. */
    source: calendarSourceEnum("source").notNull(),

    /**
     * The channel's own reservation number, when there is one. Together with
     * `source` this is what stops an email arriving twice from creating two
     * bookings — hence the unique index below.
     */
    externalRef: text("external_ref"),

    guestName: text("guest_name"),
    guestPhone: text("guest_phone"),

    /** Check-out is exclusive, matching `calendar_events`. */
    checkIn: date("check_in", { mode: "string" }).notNull(),
    checkOut: date("check_out", { mode: "string" }).notNull(),

    guests: integer("guests"),
    pets: integer("pets"),

    status: bookingStatusEnum("status").notNull().default("confirmed"),

    /** What the guest is charged in total, in paise. Null until you fill it in. */
    grossPaise: integer("gross_paise"),
    /** Channel commission, in paise. */
    commissionPaise: integer("commission_paise"),
    /** Tax withheld (TDS/GST), in paise. */
    taxPaise: integer("tax_paise"),
    /** What has actually reached you so far, in paise. */
    receivedPaise: integer("received_paise"),

    note: text("note"),

    /**
     * Set when the row was created by the email importer rather than by hand,
     * so the dashboard can flag bookings still waiting for an amount.
     */
    importedFromEmail: text("imported_from_email"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("booking_source_ref_uniq").on(table.source, table.externalRef),
    index("booking_checkin_idx").on(table.checkIn),
    index("booking_status_idx").on(table.status),
  ],
);

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;

export const expenseCategoryEnum = pgEnum("expense_category", [
  "staff",
  "utilities",
  "maintenance",
  "supplies",
  "food",
  "marketing",
  "commission",
  "other",
]);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spentOn: date("spent_on", { mode: "string" }).notNull(),
    amountPaise: integer("amount_paise").notNull(),
    category: expenseCategoryEnum("category").notNull().default("other"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("expense_date_idx").on(table.spentOn)],
);

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;

/**
 * Money actually transferred to the bank by a channel — currently captured
 * from MakeMyTrip's wire confirmation emails. Kept separate from bookings
 * because one payout can cover several stays, and reconciling the two is a
 * different question from recording either.
 */
export const payouts = pgTable(
  "payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: calendarSourceEnum("source").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    reference: text("reference"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("payout_source_ref_uniq").on(
      table.source,
      table.reference,
      table.paidOn,
    ),
    index("payout_date_idx").on(table.paidOn),
  ],
);

export type Payout = typeof payouts.$inferSelect;
export type NewPayout = typeof payouts.$inferInsert;
