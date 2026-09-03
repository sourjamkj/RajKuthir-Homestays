import { inArray } from "drizzle-orm";
import { db, appSettings, FEED_URL_KEYS } from "@workspace/db";
import type { ImportSource } from "./ics-utils";

export type FeedUrls = Record<ImportSource, string | null>;

const KEY_TO_SOURCE = new Map<string, ImportSource>(
  (Object.entries(FEED_URL_KEYS) as Array<[ImportSource, string]>).map(
    ([source, key]) => [key, source],
  ),
);

const EMPTY: FeedUrls = {
  bookingCom: null,
  airbnb: null,
  makeMyTrip: null,
};

/**
 * Reads the owner-editable OTA feed URLs. Returns null for any source the
 * owner has not set, so callers can fall back to the environment variable.
 */
export async function getFeedUrls(): Promise<FeedUrls> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(inArray(appSettings.key, Object.values(FEED_URL_KEYS)));

  const result: FeedUrls = { ...EMPTY };

  for (const row of rows) {
    const source = KEY_TO_SOURCE.get(row.key);
    const value = row.value?.trim();
    if (source && value) result[source] = value;
  }

  return result;
}

/**
 * Saves one feed URL. Passing null or an empty string clears it, which makes
 * the sync fall back to that source's environment variable (if any).
 */
export async function setFeedUrl(
  source: ImportSource,
  value: string | null,
): Promise<void> {
  const key = FEED_URL_KEYS[source];
  const trimmed = value?.trim() || null;

  await db
    .insert(appSettings)
    .values({ key, value: trimmed, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: trimmed, updatedAt: new Date() },
    });
}
