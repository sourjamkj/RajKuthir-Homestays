import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Google reviews of the listing and the owner's replies to them.
 *
 * Nothing here is ever posted to Google on its own: a reply moves from
 * `draft` to `approved` only when the owner presses Approve, and to `posted`
 * only when Google accepted it (API) or the owner says they pasted it (manual).
 *
 * Created at boot by reviews-migrate.ts. Plain text columns rather than enums
 * for status and source, so a new state never needs an ALTER TYPE.
 */
export const googleReviews = pgTable(
  "google_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Google's review id, or "manual-<uuid>" for one the owner pasted in. */
    reviewId: text("review_id").notNull(),
    /** "gbp" (Business Profile API) or "manual" (pasted into /admin). */
    source: text("source").notNull().default("manual"),

    reviewerName: text("reviewer_name"),
    rating: integer("rating").notNull(),
    text: text("text"),
    /** When the guest wrote the review (Google's createTime). */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),

    replyText: text("reply_text"),
    /** none | draft | approved | posted | skipped */
    replyStatus: text("reply_status").notNull().default("none"),
    /** Why a model draft fell back, or why posting failed. Owner-readable. */
    replyNote: text("reply_note"),

    /** The stay this is probably about. Used to personalise, never quoted. */
    matchedBookingId: uuid("matched_booking_id"),

    draftedAt: timestamp("drafted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    ownerAlertedAt: timestamp("owner_alerted_at", { withTimezone: true }),

    insertedAt: timestamp("inserted_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("google_review_id_uniq").on(table.reviewId),
    index("google_review_created_idx").on(table.createdAt),
  ],
);

export type GoogleReview = typeof googleReviews.$inferSelect;
export type NewGoogleReview = typeof googleReviews.$inferInsert;

/**
 * "Issue during stay", flagged by the owner on a booking.
 *
 * A table of its own rather than columns on `bookings`: every query in the
 * site selects from bookings, and a column the database does not have yet
 * would break all of them until the migration ran. A new table can only
 * break the feature that reads it.
 *
 * While `resolvedAt` is null the stay gets no review request and the owner
 * sees "Call guest about issue".
 */
export const bookingIssues = pgTable("booking_issues", {
  bookingId: uuid("booking_id").primaryKey(),
  note: text("note"),
  flaggedAt: timestamp("flagged_at", { withTimezone: true }).notNull().defaultNow(),
  /** The owner called the guest. Clears the task; a review ask may then be queued by hand. */
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export type BookingIssue = typeof bookingIssues.$inferSelect;
