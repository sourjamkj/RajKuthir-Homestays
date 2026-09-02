export type ImportSource = "bookingCom" | "airbnb" | "makeMyTrip";

export type ParsedEvent = {
  externalUid: string;
  startDate: string;
  endDate: string;
  title: string | null;
};

export function isSafeFeedUrl(value: string): boolean {
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
      hostname.startsWith("169.254.") ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd")
    ) {
      return false;
    }

    return !/^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
  } catch {
    return false;
  }
}

function unfold(value: string): string[] {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const unfolded: string[] = [];

  for (const line of normalized.split("\n")) {
    if (
      (line.startsWith(" ") || line.startsWith("\t")) &&
      unfolded.length > 0
    ) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }

  return unfolded;
}

function propertyValue(lines: string[], name: string): string | null {
  const line = lines.find(
    (candidate) =>
      candidate.startsWith(`${name}:`) ||
      candidate.startsWith(`${name};`),
  );
  if (!line) return null;

  const separator = line.indexOf(":");
  return separator >= 0 ? line.slice(separator + 1) : null;
}

function toIsoDate(raw: string): string | null {
  const match = raw.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

export function parseIcs(content: string, _source: ImportSource): ParsedEvent[] {
  const lines = unfold(content);
  const events: ParsedEvent[] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = [];
      continue;
    }

    if (line === "END:VEVENT" && current) {
      const start = propertyValue(current, "DTSTART");
      const end = propertyValue(current, "DTEND");
      const status = propertyValue(current, "STATUS")?.toUpperCase();
      const transparency = propertyValue(current, "TRANSP")?.toUpperCase();
      const startDate = start ? toIsoDate(start) : null;
      const endDate = end ? toIsoDate(end) : null;

      if (
        startDate &&
        endDate &&
        startDate < endDate &&
        status !== "CANCELLED" &&
        transparency !== "TRANSPARENT"
      ) {
        const uid = propertyValue(current, "UID") ?? `${startDate}-${endDate}`;
        const recurrenceId = propertyValue(current, "RECURRENCE-ID");
        const externalUid = [uid, recurrenceId]
          .filter(Boolean)
          .join("#")
          .replace(/[^a-zA-Z0-9_@.#-]/g, "-");
        const summary = propertyValue(current, "SUMMARY");

        events.push({
          externalUid: externalUid || `${startDate}-${endDate}-${events.length}`,
          startDate,
          endDate,
          title: summary ? unescapeIcsText(summary) : null,
        });
      }

      current = null;
      continue;
    }

    if (current) current.push(line);
  }

  return Array.from(
    new Map(
      events.map((event) => [
        `${event.externalUid}:${event.startDate}:${event.endDate}`,
        event,
      ]),
    ).values(),
  );
}

export async function fetchFeed(url: string): Promise<string> {
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
      redirect: "error",
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