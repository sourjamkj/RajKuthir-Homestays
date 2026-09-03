import { logger } from "./logger";
import { fetchFeed, parseIcs, type ImportSource } from "./ics-utils";
import { replaceSourceEvents } from "./calendar-repo";

export const SOURCE_DEFINITIONS: Array<{
  key: ImportSource;
  label: string;
}> = [
  { key: "bookingCom", label: "Booking.com" },
  { key: "airbnb", label: "Airbnb" },
  { key: "makeMyTrip", label: "MakeMyTrip" },
];

const SECURE_FEED_URLS: Record<ImportSource, string | undefined> = {
  bookingCom: process.env.RAJ_KUTHIR_BOOKING_ICAL_URL,
  airbnb: process.env.RAJ_KUTHIR_AIRBNB_ICAL_URL,
  makeMyTrip: process.env.RAJ_KUTHIR_MAKEMYTRIP_ICAL_URL,
};

export type SyncSourceStatus = {
  source: ImportSource;
  label: string;
  status: "connected" | "missing" | "error";
  eventCount: number;
  message: string;
  lastSyncedAt: string | null;
};

export type CalendarSyncResult = {
  syncedAt: string;
  totalEvents: number;
  sources: SyncSourceStatus[];
};

let activeSync: Promise<CalendarSyncResult> | null = null;

/**
 * Last completed sync, kept in memory so the admin dashboard can show
 * per-source status on load without forcing a fresh round-trip to every OTA.
 * Resets on restart, which is fine — the cron runs 10s after boot.
 */
let lastSyncResult: CalendarSyncResult | null = null;

export function getLastSyncResult(): CalendarSyncResult | null {
  return lastSyncResult;
}

/** True while a sync is in flight, so the UI can show it as running. */
export function isSyncInFlight(): boolean {
  return activeSync !== null;
}

async function runSync(
  overrides: Partial<Record<ImportSource, string | null | undefined>>,
): Promise<CalendarSyncResult> {
  const syncedAt = new Date().toISOString();
  const sources: SyncSourceStatus[] = [];
  let totalEvents = 0;

  for (const definition of SOURCE_DEFINITIONS) {
    const url = overrides[definition.key] || SECURE_FEED_URLS[definition.key];

    if (!url) {
      sources.push({
        source: definition.key,
        label: definition.label,
        status: "missing",
        eventCount: 0,
        message: "Add an iCal feed URL to connect this source.",
        lastSyncedAt: null,
      });
      continue;
    }

    try {
      const events = parseIcs(await fetchFeed(url), definition.key);
      const count = await replaceSourceEvents(definition.key, events);
      totalEvents += count;
      sources.push({
        source: definition.key,
        label: definition.label,
        status: "connected",
        eventCount: count,
        message: count
          ? "Feed synced and saved."
          : "Feed connected; no blocked dates found.",
        lastSyncedAt: syncedAt,
      });
      logger.info(
        { source: definition.key, eventCount: count },
        "Calendar feed synced",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to read this feed.";
      sources.push({
        source: definition.key,
        label: definition.label,
        status: "error",
        eventCount: 0,
        message,
        lastSyncedAt: null,
      });
      logger.warn(
        { source: definition.key, err: message },
        "Calendar feed sync failed",
      );
    }
  }

  const result = { syncedAt, totalEvents, sources };
  lastSyncResult = result;
  return result;
}

export function syncCalendarSources(
  overrides: Partial<Record<ImportSource, string | null | undefined>> = {},
): Promise<CalendarSyncResult> {
  if (!activeSync) {
    activeSync = runSync(overrides).finally(() => {
      activeSync = null;
    });
  }

  return activeSync;
}