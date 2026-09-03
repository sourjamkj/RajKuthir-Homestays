import {
  pgTable,
  boolean,
  index,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Marketing state for a guest, keyed by their phone number.
 *
 * Deliberately NOT a copy of guest details. Names, dates and amounts already
 * live in `bookings` and `enquiries`; duplicating them here would mean two
 * versions of the truth that drift apart. The contact list is instead built by
 * aggregating those tables at query time, and this table holds only the parts
 * that cannot be derived — whether they have opted out, and what the owner
 * wants to remember about them.
 *
 * `phone` is stored normalised (digits only, last 10) so the same person
 * reached through Airbnb, Booking.com and WhatsApp resolves to one contact.
 */
export const guestContacts = pgTable(
  "guest_contacts",
  {
    /** Normalised phone: digits only, last 10. The identity of a contact. */
    phone: text("phone").primaryKey(),

    /**
     * Opted out of marketing. Nothing promotional should ever be sent to a
     * contact with this set — it is the only field that overrides everything
     * else in the list.
     */
    marketingOptOut: boolean("marketing_opt_out").notNull().default(false),

    /** Owner's own notes — dietary needs, who they came with, what they liked. */
    note: text("note"),

    /** Free-form comma-separated labels, e.g. "repeat, pet owner, corporate". */
    tags: text("tags"),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("guest_contact_optout_idx").on(table.marketingOptOut)],
);

export type GuestContact = typeof guestContacts.$inferSelect;

/**
 * Reduces any written phone number to a comparable identity: digits only,
 * last 10. Handles +91 prefixes, spaces, dashes and brackets, which is how
 * the same number arrives looking different from three different channels.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}
