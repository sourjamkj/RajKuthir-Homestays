import {
  pgTable,
  pgEnum,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Outbound WhatsApp messages, as a queue rather than a fire-and-forget call.
 *
 * Nothing sends inline from a request handler. Messages are written here
 * first, then a cron drains them. That buys four things that matter when the
 * recipient is a real guest:
 *
 *  - an audit trail of exactly what was sent, to whom, and when;
 *  - retries with backoff, since the Cloud API rate-limits and times out;
 *  - idempotency — the unique index below makes it impossible to send the
 *    same kind of message twice for one booking, however many times the
 *    scheduler runs;
 *  - a hold point: a row can sit in `draft` until the owner releases it.
 */

export const messageKindEnum = pgEnum("message_kind", [
  /** Utility: sent right after a booking is confirmed. */
  "booking_confirmed",
  /** Utility: the day before arrival, with directions and the caretaker's number. */
  "checkin_reminder",
  /** Utility: the morning of departure. */
  "checkout_today",
  /** Marketing: asks for a Google review a day after checkout. */
  "review_request",
]);

export const messageStatusEnum = pgEnum("message_status", [
  /** Queued but deliberately held — the owner has to release it. */
  "draft",
  /** Ready to send once `sendAfter` passes. */
  "pending",
  /** Handed to the provider and accepted. */
  "sent",
  /** Provider rejected it, or retries ran out. `error` says why. */
  "failed",
  /** The owner cancelled it before it went out. */
  "cancelled",
]);

export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** The booking this is about. Null for messages not tied to a stay. */
    bookingId: uuid("booking_id"),

    kind: messageKindEnum("kind").notNull(),
    status: messageStatusEnum("status").notNull().default("pending"),

    /** E.164 without the leading '+', which is what the Cloud API wants. */
    toPhone: text("to_phone").notNull(),

    /** Meta template name and the ordered body parameters it was filled with. */
    templateName: text("template_name").notNull(),
    templateParams: jsonb("template_params").$type<string[]>().notNull(),

    /**
     * Plain-text rendering of what the guest will see. Stored because a
     * template can be edited in Meta's console afterwards, and the owner
     * needs to know what actually went out, not what would go out today.
     */
    preview: text("preview").notNull(),

    /** Not before this time. Used for reminders and quiet hours. */
    sendAfter: timestamp("send_after", { withTimezone: true })
      .notNull()
      .defaultNow(),

    attempts: integer("attempts").notNull().default(0),
    error: text("error"),

    /** The provider's message id, once accepted. */
    providerMessageId: text("provider_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One message of each kind per booking, ever. This is the whole
    // anti-duplicate story: the scheduler can run as often as it likes.
    uniqueIndex("whatsapp_booking_kind_uniq").on(table.bookingId, table.kind),
    index("whatsapp_due_idx").on(table.status, table.sendAfter),
  ],
);

export type WhatsappMessage = typeof whatsappMessages.$inferSelect;
export type NewWhatsappMessage = typeof whatsappMessages.$inferInsert;

/** Kinds that need marketing consent. Everything else is transactional. */
export const MARKETING_KINDS = ["review_request"] as const;
