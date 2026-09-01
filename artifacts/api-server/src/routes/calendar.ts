import { Router, type IRouter } from "express";
import { SyncCalendarsBody, SyncCalendarsResponse } from "@workspace/api-zod";
import { getAuth } from "@clerk/express";

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