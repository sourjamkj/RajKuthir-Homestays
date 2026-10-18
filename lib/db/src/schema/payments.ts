import {
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { enquiries } from "./enquiries";

/**
 * Self-serve "Book & Pay by UPI".
 *
 * NOT a second booking system. Every row here belongs to exactly one enquiry,
 * and the enquiry is still what gets quoted, marked paid and converted into a
 * booking by the existing pipeline (enquiries.ts / enquiry-conversion.ts).
 * This table only holds what the enquiry has no column for: the payment
 * link, the hold deadline, and the guest's claim to have paid.
 *
 * Kept in its own table on purpose. Adding columns to `enquiries` would make
 * every existing SELECT on that table fail until the migration ran — the
 * exact drift that took production down four times (see schema-check.ts).
 * A new table cannot break anything that does not read it.
 */

// Same local helper as guests.ts: drizzle does not export bytea.
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const paymentRequestStatusEnum = pgEnum("payment_request_status", [
  /** Dates held, waiting for the guest to pay and send the UTR. */
  "awaiting_payment",
  /** Guest says they paid. Waiting for the owner to check the bank. */
  "submitted",
  /** Owner saw the money. The enquiry is now a confirmed booking. */
  "confirmed",
  /** Owner could not find the money (or turned it down). Dates released. */
  "rejected",
  /** Nobody paid before the hold ran out. Dates released. */
  "expired",
]);

export const paymentRequests = pgTable(
  "payment_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    enquiryId: uuid("enquiry_id")
      .notNull()
      .references(() => enquiries.id, { onDelete: "cascade" }),

    /**
     * SHA-256 of the bearer token in the guest's /pay link. The token itself
     * is never stored: a database dump must not hand anyone a payment page.
     */
    tokenHash: text("token_hash").notNull(),

    /**
     * The RK- reference the booking WILL have. Issued now so it can travel as
     * the UPI transaction note (`tn`), which is how the owner matches a credit
     * in the bank app to a guest. Passed to createBooking on confirm.
     */
    reference: text("reference").notNull(),

    status: paymentRequestStatusEnum("status").notNull().default("awaiting_payment"),

    /** What the guest owes now and in total, recomputed by the server. Paise. */
    totalPaise: integer("total_paise").notNull(),
    advancePaise: integer("advance_paise").notNull(),
    advancePercent: integer("advance_percent").notNull(),

    /** When the dates stop being held. Extended when a UTR arrives. */
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }).notNull(),

    /** 12-digit UPI transaction reference. Unique: one payment, one booking. */
    utr: text("utr"),
    utrSubmittedAt: timestamp("utr_submitted_at", { withTimezone: true }),

    screenshot: bytea("screenshot"),
    screenshotMime: text("screenshot_mime"),
    screenshotBytes: integer("screenshot_bytes"),

    decidedAt: timestamp("decided_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),

    /** Set once the "your hold expired" message has gone, so it goes once. */
    expiryNotifiedAt: timestamp("expiry_notified_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_request_token_uniq").on(table.tokenHash),
    uniqueIndex("payment_request_reference_uniq").on(table.reference),
    uniqueIndex("payment_request_utr_uniq").on(table.utr),
    uniqueIndex("payment_request_enquiry_uniq").on(table.enquiryId),
    index("payment_request_status_idx").on(table.status),
  ],
);

export type PaymentRequest = typeof paymentRequests.$inferSelect;
export type NewPaymentRequest = typeof paymentRequests.$inferInsert;

/**
 * Append-only history of every state change, read by the owner's activity
 * panel. Never updated, never deleted except with the request itself.
 */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentRequestId: uuid("payment_request_id")
      .notNull()
      .references(() => paymentRequests.id, { onDelete: "cascade" }),
    /** held | utr_submitted | confirmed | rejected | expired | expiry_notified */
    kind: text("kind").notNull(),
    detail: text("detail"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("payment_event_at_idx").on(table.at)],
);

export type PaymentEvent = typeof paymentEvents.$inferSelect;
