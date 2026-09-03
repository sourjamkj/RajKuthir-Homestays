import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { requireAdmin } from "../lib/admin-auth";
import {
  BlockDatesBody,
  CalendarEventDto,
  SyncCalendarsBody,
  type CalendarEventDto as CalendarEventDtoType,
} from "@workspace/api-zod";
import {
  OWNED_SOURCES,
  deleteOwnedEvent,
  createManualBlock,
  listAllEvents,
  listFeedEvents,
  listPublicBlocks,
} from "../lib/calendar-repo";
import {
  SOURCE_DEFINITIONS,
  getLastSyncResult,
  syncCalendarSources,
} from "../lib/calendar-sync";
import { getFeedUrls, setFeedUrl } from "../lib/settings-repo";
import {
  fetchFeed,
  isSafeFeedUrl,
  parseIcs,
  type ImportSource,
} from "../lib/ics-utils";

const router: IRouter = Router();
const CALENDAR_FEED_TOKEN = process.env.RAJ_KUTHIR_CALENDAR_FEED_TOKEN;

/**
 * Whether each source has an environment-variable fallback configured. Only
 * presence is exposed to the client, never the URL itself.
 */
const ENV_VAR_NAMES: Record<ImportSource, string> = {
  bookingCom: "RAJ_KUTHIR_BOOKING_ICAL_URL",
  airbnb: "RAJ_KUTHIR_AIRBNB_ICAL_URL",
  makeMyTrip: "RAJ_KUTHIR_MAKEMYTRIP_ICAL_URL",
};

const ENV_FEED_URL_PRESENT: Record<ImportSource, boolean> = {
  bookingCom: Boolean(process.env[ENV_VAR_NAMES.bookingCom]),
  airbnb: Boolean(process.env[ENV_VAR_NAMES.airbnb]),
  makeMyTrip: Boolean(process.env[ENV_VAR_NAMES.makeMyTrip]),
};

const IMPORT_SOURCES: readonly ImportSource[] = [
  "bookingCom",
  "airbnb",
  "makeMyTrip",
];

function isImportSource(value: unknown): value is ImportSource {
  return (
    typeof value === "string" &&
    (IMPORT_SOURCES as readonly string[]).includes(value)
  );
}

const CALENDAR_SOURCES = [
  "manual",
  "direct",
  "bookingCom",
  "airbnb",
  "makeMyTrip",
] as const;

function isCalendarSource(value: unknown): value is CalendarEventDtoType["source"] {
  return (
    typeof value === "string" &&
    (CALENDAR_SOURCES as readonly string[]).includes(value)
  );
}

function toEventDto(event: Awaited<ReturnType<typeof listAllEvents>>[number]) {
  return CalendarEventDto.parse({
    id: event.id,
    source: event.source,
    startDate: event.startDate,
    endDate: event.endDate,
    title: event.title,
    note: event.note,
    editable: (OWNED_SOURCES as readonly string[]).includes(event.source),
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isValidFeedToken(value: unknown): value is string {
  if (!CALENDAR_FEED_TOKEN || typeof value !== "string") return false;

  const expected = Buffer.from(CALENDAR_FEED_TOKEN);
  const received = Buffer.from(value);
  return (
    expected.length === received.length &&
    crypto.timingSafeEqual(expected, received)
  );
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function toIcsDate(value: string): string {
  return value.replaceAll("-", "");
}

function renderIcsFeed(
  events: Array<{ id: string; startDate: string; endDate: string }>,
): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const rows = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Raj Kuthir Homestays//Sobuj Potro//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Raj Kuthir Sobuj Potro",
    "X-WR-TIMEZONE:Asia/Kolkata",
  ];

  for (const event of events) {
    rows.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(event.id)}@rajkuthirhomestays`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${toIcsDate(event.startDate)}`,
      `DTEND;VALUE=DATE:${toIcsDate(event.endDate)}`,
      "SUMMARY:Reserved - Raj Kuthir",
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }

  rows.push("END:VCALENDAR");
  return `${rows.join("\r\n")}\r\n`;
}

router.get("/calendar/events", requireAdmin, async (_req, res) => {
  const events = await listAllEvents();
  res.setHeader("Cache-Control", "no-store");
  res.json({ events: events.map(toEventDto) });
});

router.get("/calendar/public", async (_req, res) => {
  const blocks = await listPublicBlocks();
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({ blocks });
});

router.post("/calendar/block", requireAdmin, async (req, res) => {
  const parsed = BlockDatesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Invalid blocked date range.",
    });
    return;
  }

  const created = await createManualBlock(parsed.data);
  res.status(201).json(toEventDto(created));
});

router.delete("/calendar/block/:id", requireAdmin, async (req, res) => {
  // Express 5 types a route param as `string | string[]`; `:id` is always a
  // single path segment at runtime, so narrow it before validating.
  const id = Array.isArray(req.params.id) ? "" : req.params.id;
  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid calendar event id." });
    return;
  }

  const deleted = await deleteOwnedEvent(id);
  if (!deleted) {
    res.status(404).json({
      error: "Not found, or it is an OTA booking that cannot be removed here.",
    });
    return;
  }

  res.status(204).end();
});

router.post("/calendar/sync", requireAdmin, async (req, res) => {
  const parsed = SyncCalendarsBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Please provide valid calendar feed settings." });
    return;
  }

  const result = await syncCalendarSources(parsed.data);
  const events = await listAllEvents();
  res.json({
    ...result,
    totalEvents: events.length,
    events: events.map(toEventDto),
  });
});

/**
 * The owner-editable OTA import URLs, shown in the dashboard so a feed can be
 * repointed without a redeploy. Admin-only: these URLs are secrets, since
 * anyone holding one can read booking dates. `source` tells the UI whether a
 * value came from the database or is still falling back to an env var.
 */
router.get("/calendar/feed-sources", requireAdmin, async (_req, res) => {
  const stored = await getFeedUrls();

  res.setHeader("Cache-Control", "no-store");
  res.json({
    sources: SOURCE_DEFINITIONS.map((definition) => {
      const saved = stored[definition.key];
      const fromEnv = ENV_FEED_URL_PRESENT[definition.key];

      return {
        source: definition.key,
        label: definition.label,
        url: saved ?? "",
        // The env value is deliberately not sent — it is only reported as present.
        usingEnvFallback: !saved && fromEnv,
      };
    }),
  });
});

router.put("/calendar/feed-sources/:source", requireAdmin, async (req, res) => {
  const source = req.params.source;

  if (!isImportSource(source)) {
    res.status(400).json({ error: "Unknown calendar source." });
    return;
  }

  const raw: unknown = req.body?.url;
  const value = typeof raw === "string" ? raw.trim() : "";

  if (value.length > 2000) {
    res.status(400).json({ error: "That URL is too long." });
    return;
  }

  // An empty value clears the override and falls back to the env var.
  if (value && !isSafeFeedUrl(value)) {
    res.status(400).json({
      error:
        "Enter a public http(s) calendar feed URL. Private and local addresses are not allowed.",
    });
    return;
  }

  await setFeedUrl(source, value || null);
  res.json({ source, url: value, saved: true });
});

/**
 * Live look at exactly what one OTA is currently exporting, without writing
 * anything to the database.
 *
 * This exists to settle the recurring "I unblocked it there but it is still
 * blocked here" question: if a date still appears here, the OTA is still
 * publishing it and the sync is behaving correctly. Titles are included
 * because they reveal echoes — a block that originated from our own outbound
 * feed usually comes back with a tell-tale summary.
 *
 * The feed URL is a secret, so only its host is returned.
 */
router.get("/calendar/inspect/:source", requireAdmin, async (req, res) => {
  const source = Array.isArray(req.params.source) ? "" : req.params.source;

  if (!isImportSource(source)) {
    res.status(400).json({ error: "Unknown calendar source." });
    return;
  }

  const stored = await getFeedUrls();
  const url = stored[source] || process.env[ENV_VAR_NAMES[source]];

  if (!url) {
    res.status(400).json({
      error: "No feed URL is configured for this channel yet.",
    });
    return;
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const raw = await fetchFeed(url);
    const events = parseIcs(raw, source);
    const today = new Date().toISOString().slice(0, 10);

    res.json({
      source,
      feedHost: new URL(url).host,
      fetchedAt: new Date().toISOString(),
      rawBytes: raw.length,
      // Every VEVENT block in the file, including ones the parser discards.
      rawEventBlocks: (raw.match(/BEGIN:VEVENT/g) ?? []).length,
      eventCount: events.length,
      events: events
        .slice()
        .sort((left, right) => left.startDate.localeCompare(right.startDate))
        .map((event) => ({
          startDate: event.startDate,
          endDate: event.endDate,
          title: event.title,
          past: event.endDate <= today,
        })),
    });
  } catch (error) {
    res.status(502).json({
      error:
        error instanceof Error
          ? error.message
          : "Could not read this calendar feed.",
    });
  }
});

/**
 * Per-source sync status for the admin dashboard, served from the last
 * completed sync so opening the page is cheap. Sources that have never been
 * reached are reported as "missing" rather than omitted, so the dashboard can
 * always render one row per OTA.
 */
router.get("/calendar/sync-status", requireAdmin, (_req, res) => {
  const last = getLastSyncResult();
  const bySource = new Map(
    (last?.sources ?? []).map((status) => [status.source, status]),
  );

  res.setHeader("Cache-Control", "no-store");
  res.json({
    syncedAt: last?.syncedAt ?? null,
    totalEvents: last?.totalEvents ?? 0,
    sources: SOURCE_DEFINITIONS.map(
      (definition) =>
        bySource.get(definition.key) ?? {
          source: definition.key,
          label: definition.label,
          status: "missing" as const,
          eventCount: 0,
          message: "Not synced yet.",
          lastSyncedAt: null,
        },
    ),
  });
});

router.get("/calendar/feed-info", requireAdmin, (req, res) => {
  if (!CALENDAR_FEED_TOKEN) {
    res.status(503).json({ error: "Outbound calendar feed is not configured yet." });
    return;
  }

  const protocol =
    req.headers["x-forwarded-proto"]?.toString().split(",")[0].trim() ||
    req.protocol;
  const host =
    req.headers["x-forwarded-host"]?.toString().split(",")[0].trim() ||
    req.get("host");

  if (!host) {
    res.status(503).json({ error: "Calendar feed host is unavailable." });
    return;
  }

  const baseUrl = new URL("/api/calendar/feed", `${protocol}://${host}`);
  const makeFeedUrl = (exclude?: ImportSource) => {
    const feedUrl = new URL(baseUrl);
    feedUrl.searchParams.set("token", CALENDAR_FEED_TOKEN);
    if (exclude) feedUrl.searchParams.set("exclude", exclude);
    return feedUrl.toString();
  };

  res.setHeader("Cache-Control", "no-store");
  res.json({
    feedUrl: makeFeedUrl(),
    bookingCom: makeFeedUrl("bookingCom"),
    airbnb: makeFeedUrl("airbnb"),
    makeMyTrip: makeFeedUrl("makeMyTrip"),
  });
});

router.get("/calendar/feed", async (req, res) => {
  if (!isValidFeedToken(req.query.token)) {
    res.status(401).type("text/plain").send("Invalid calendar feed token.");
    return;
  }

  const excludeValue =
    typeof req.query.exclude === "string" ? req.query.exclude : undefined;
  const excludeSource = isCalendarSource(excludeValue)
    ? excludeValue
    : undefined;
  const events = await listFeedEvents(excludeSource);

  res.setHeader("Cache-Control", "no-cache, max-age=0");
  res.type("text/calendar").send(renderIcsFeed(events));
});

export default router;