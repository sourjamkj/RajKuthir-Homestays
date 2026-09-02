import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import crypto from "node:crypto";
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
  syncCalendarSources,
} from "../lib/calendar-sync";
import type { ImportSource } from "../lib/ics-utils";

const router: IRouter = Router();
const CALENDAR_FEED_TOKEN = process.env.RAJ_KUTHIR_CALENDAR_FEED_TOKEN;
const ADMIN_USER_IDS = (process.env.RAJ_KUTHIR_ADMIN_USER_IDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

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

function requireAdmin(req: any, res: any, next: any): void {
  const { userId } = getAuth(req);

  if (!userId) {
    res.status(401).json({ error: "Admin sign-in required." });
    return;
  }

  if (ADMIN_USER_IDS.length === 0) {
    res.status(503).json({ error: "Admin access is not configured." });
    return;
  }

  if (!ADMIN_USER_IDS.includes(userId)) {
    res.status(403).json({ error: "This account is not an authorised admin." });
    return;
  }

  next();
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
  if (!isUuid(req.params.id)) {
    res.status(400).json({ error: "Invalid calendar event id." });
    return;
  }

  const deleted = await deleteOwnedEvent(req.params.id);
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