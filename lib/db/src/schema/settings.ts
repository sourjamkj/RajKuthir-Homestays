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
