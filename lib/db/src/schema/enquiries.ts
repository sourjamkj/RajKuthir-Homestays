import {
  pgTable,
  pgEnum,
  date,
  index,
  integer,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Guest enquiries from the public form.
 *
 * These were previously discarded — the form showed a success message and
 * offered a WhatsApp link, but nothing reached the server, so anyone who did
 * not then click through to WhatsApp was lost silently.
 *
 * They serve two purposes now: a lead list the owner can work through, and the
 * demand signal behind range-based peak pricing.
 */

export const enquiryStatusEnum = pgEnum("enquiry_status", [
  "new",
  "contacted",
  "converted",
  "closed",
]);

export const enquiries = pgTable(
  "enquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    name: text("name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),

    checkIn: date("check_in", { mode: "string" }),
    checkOut: date("check_out", { mode: "string" }),

    adults: integer("adults"),
    children: integer("children"),
    pets: integer("pets"),

    requests: text("requests"),
    status: enquiryStatusEnum("status").notNull().default("new"),

    /**
     * What was quoted to this guest, and when it was sent.
     *
     * Stored rather than recomputed because a quote is a promise: if the rate
     * plan changes next week, what the guest was told does not. Money in
     * PAISE, matching the ledger and the rate plan. Null until a quote is
     * actually sent — these three move together or not at all.
     */
    quotedTotalPaise: integer("quoted_total_paise"),
    quotedAdvancePaise: integer("quoted_advance_paise"),
    quoteSentAt: timestamp("quote_sent_at", { withTimezone: true }),

    /**
     * When the advance actually arrived. Null means it has not.
     *
     * This is the only thing that stops a quoted enquiry's dates being
     * released 24 hours after the quote went out. The hold itself is not
     * stored — it is derived from these two timestamps, so it cannot be left
     * behind by a job that failed to run. See lib/enquiry-hold.ts.
     */
    advancePaidAt: timestamp("advance_paid_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("enquiry_created_idx").on(table.createdAt),
    index("enquiry_dates_idx").on(table.checkIn, table.checkOut),
    index("enquiry_status_idx").on(table.status),
  ],
);

export type Enquiry = typeof enquiries.$inferSelect;
export type NewEnquiry = typeof enquiries.$inferInsert;
