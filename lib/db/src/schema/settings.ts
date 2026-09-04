import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Small key/value store for owner-editable settings that would otherwise be
 * environment variables — currently the three OTA iCal import URLs.
 *
 * These live in the database rather than the environment so the owner can
 * paste a new feed URL from the admin dashboard without a redeploy. Values
 * are secrets (anyone holding an OTA feed URL can read booking dates), so
 * every route that reads or writes this table is admin-guarded.
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AppSetting = typeof appSettings.$inferSelect;

/** Setting keys used by the calendar sync. */
export const FEED_URL_KEYS = {
  bookingCom: "feed_url.bookingCom",
  airbnb: "feed_url.airbnb",
  makeMyTrip: "feed_url.makeMyTrip",
} as const;

/**
 * The arrival pack shown on /welcome once a guest has entered their booking
 * reference: Wi-Fi credentials, directions and the on-call contact numbers.
 *
 * Stored as one JSON document under a single key rather than a column per
 * field, because the contact list is variable-length and the shape will keep
 * changing — and because this table is already the place the owner edits
 * things without a redeploy. Rotating the Wi-Fi password has to be a text box,
 * not a deployment, or it will never happen.
 */
export const GUEST_INFO_KEY = "guest_info" as const;
