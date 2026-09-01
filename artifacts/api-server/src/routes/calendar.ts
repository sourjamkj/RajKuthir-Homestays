import { Router, type IRouter } from "express";
import { SyncCalendarsBody, SyncCalendarsResponse } from "@workspace/api-zod";
import { getAuth } from "@clerk/express";
import crypto from "node:crypto";

type CalendarSource = "bookingCom" | "airbnb" | "makeMyTrip";

type ParsedEvent = {
  id: string;
  source: CalendarSource;
  title: string | null;
  start: string;
  end: string;
  allDay: boolean;
};

const SOURCE_DEFINITIONS: Array<{
  key: CalendarSource;
  label: string;
}> = [
  { key: "bookingCom", label: "Booking.com" },
  { key: "airbnb", label: "Airbnb" },
  { key: "makeMyTrip", label: "MakeMyTrip" },
];

const SECURE_FEED_URLS: Partial<Record<CalendarSource, string | undefined>> = {
  bookingCom: process.env.RAJ_KUTHIR_BOOKING_ICAL_URL,
  airbnb: process.env.RAJ_KUTHIR_AIRBNB_ICAL_URL,
  makeMyTrip: process.env.RAJ_KUTHIR_MAKEMYTRIP_ICAL_URL,
};
const CALENDAR_FEED_TOKEN = process.env.RAJ_KUTHIR_CALENDAR_FEED_TOKEN;

const router: IRouter = Router();

const requireAdmin = (req: any, res: any, next: any) => {
  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId || auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Admin sign-in required." });
    return;
  }
  req.userId = userId;
  next();
};

function isSafeFeedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;

    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.endsWith(".local") ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("169.254.")
    ) {
      return false;
    }

    const private172 = /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    return !private172;
  } catch {
    return false;
  }
}

function unfoldIcsLines(value: string): string[] {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const unfolded: string[] = [];

  for (const line of normalized.split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }

  return unfolded;
}

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function dateFromIcsValue(value: string): { date: string; allDay: boolean } | null {
  const raw = value.trim();
  const dateOnly = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnly) {
    return {
      date: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`,
      allDay: true,
    };
  }

  const dateTime = raw.match(/^(\d{4})(\d{2})(\d{2})T/);
  if (dateTime) {
    return {
      date: `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}`,
      allDay: false,
    };
  }

  return null;
}

function valueForProperty(lines: string[], property: string): string | null {
  const line = lines.find((candidate) => candidate.startsWith(`${property}:`) || candidate.startsWith(`${property};`));
  if (!line) return null;
  const separator = line.indexOf(":");
  return separator >= 0 ? line.slice(separator + 1) : null;
}

function parseIcsFeed(source: CalendarSource, content: string): ParsedEvent[] {
  const lines = unfoldIcsLines(content);
  const events: ParsedEvent[] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") current = [];
    else if (line === "END:VEVENT" && current) {
      const startValue = valueForProperty(current, "DTSTART");
      const endValue = valueForProperty(current, "DTEND");
      const start = startValue ? dateFromIcsValue(startValue) : null;
      const end = endValue ? dateFromIcsValue(endValue) : null;
      const status = valueForProperty(current, "STATUS")?.toUpperCase();
      const transparency = valueForProperty(current, "TRANSP")?.toUpperCase();

      if (start && end && status !== "CANCELLED" && transparency !== "TRANSPARENT") {
        const uid = valueForProperty(current, "UID") ?? `${start.date}-${end.date}-${events.length}`;
        const summary = valueForProperty(current, "SUMMARY");
        events.push({
          id: `${source}-${uid}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
          source,
          title: summary ? unescapeIcsText(summary) : null,
          start: start.date,
          end: end.date,
          allDay: start.allDay && end.allDay,
        });
      }
      current = null;
    } else if (current) {
      current.push(line);
    }
  }

  return events;
}

async function fetchFeed(url: string): Promise<string> {
  if (!isSafeFeedUrl(url)) {
    throw new Error("Enter a public http(s) calendar feed URL.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/calendar,text/plain;q=0.9,*/*;q=0.1",
        "User-Agent": "Raj-Kuthir-Calendar-Sync/1.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Feed returned ${response.status}.`);
    }

    const content = await response.text();
    if (content.length > 2_000_000) {
      throw new Error("Feed is larger than the supported 2 MB limit.");
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

async function collectSecureEvents(): Promise<ParsedEvent[]> {
  const events: ParsedEvent[] = [];
  for (const definition of SOURCE_DEFINITIONS) {
    const url = SECURE_FEED_URLS[definition.key];
    if (!url) continue;
    try {
      events.push(...parseIcsFeed(definition.key, await fetchFeed(url)));
    } catch {
      // One unavailable OTA should not prevent the aggregate feed from serving
      // events from the other connected sources.
    }
  }
  return Array.from(new Map(events.map((event) => [event.id, event])).values()).sort((left, right) => left.start.localeCompare(right.start));
}

function isValidFeedToken(value: unknown): value is string {
  if (!CALENDAR_FEED_TOKEN || typeof value !== "string") return false;
  const expected = Buffer.from(CALENDAR_FEED_TOKEN);
  const received = Buffer.from(value);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function toIcsDate(value: string): string {
  return value.replaceAll("-", "");
}

function renderIcsFeed(events: ParsedEvent[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
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
      `DTSTART;VALUE=DATE:${toIcsDate(event.start)}`,
      `DTEND;VALUE=DATE:${toIcsDate(event.end)}`,
      "SUMMARY:Reserved - Raj Kuthir",
      "END:VEVENT",
    );
  }

  rows.push("END:VCALENDAR");
  return `${rows.join("\r\n")}\r\n`;
}

router.get("/calendar/feed-info", requireAdmin, (req, res) => {
  if (!CALENDAR_FEED_TOKEN) {
    res.status(503).json({ error: "Outbound calendar feed is not configured yet." });
    return;
  }

  const protocol = req.headers["x-forwarded-proto"]?.toString().split(",")[0].trim() || req.protocol;
  const host = req.headers["x-forwarded-host"]?.toString().split(",")[0].trim() || req.get("host");
  const feedUrl = new URL("/api/calendar/feed", `${protocol}://${host}`);
  feedUrl.searchParams.set("token", CALENDAR_FEED_TOKEN);
  res.setHeader("Cache-Control", "no-store");
  res.json({ feedUrl: feedUrl.toString() });
});

router.get("/calendar/feed", async (req, res) => {
  if (!isValidFeedToken(req.query.token)) {
    res.status(401).type("text/plain").send("Invalid calendar feed token.");
    return;
  }

  const events = await collectSecureEvents();
  res.setHeader("Cache-Control", "no-cache, max-age=0");
  res.type("text/calendar").send(renderIcsFeed(events));
});

router.post("/calendar/sync", requireAdmin, async (req, res) => {
  const body = SyncCalendarsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Please provide valid calendar feed settings." });
    return;
  }

  const syncedAt = new Date().toISOString();
  const allEvents: ParsedEvent[] = [];
  const sources = [];

  for (const definition of SOURCE_DEFINITIONS) {
    const url = body.data[definition.key] || SECURE_FEED_URLS[definition.key];
    if (!url) {
      sources.push({
        source: definition.key,
        label: definition.label,
        status: "missing" as const,
        eventCount: 0,
        message: "Add an iCal feed URL to connect this source.",
        lastSyncedAt: null,
      });
      continue;
    }

    try {
      const events = parseIcsFeed(definition.key, await fetchFeed(url));
      allEvents.push(...events);
      sources.push({
        source: definition.key,
        label: definition.label,
        status: "connected" as const,
        eventCount: events.length,
        message: events.length ? "Feed synced successfully." : "Feed connected; no blocked dates found.",
        lastSyncedAt: syncedAt,
      });
      req.log.info({ source: definition.key, eventCount: events.length }, "Calendar feed synced");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read this feed.";
      sources.push({
        source: definition.key,
        label: definition.label,
        status: "error" as const,
        eventCount: 0,
        message,
        lastSyncedAt: null,
      });
      req.log.warn({ source: definition.key, err: message }, "Calendar feed sync failed");
    }
  }

  const uniqueEvents = Array.from(new Map(allEvents.map((event) => [event.id, event])).values())
    .sort((left, right) => left.start.localeCompare(right.start));

  const result = SyncCalendarsResponse.parse({
    syncedAt,
    events: uniqueEvents,
    sources,
  });
  res.json(result);
});

export default router;