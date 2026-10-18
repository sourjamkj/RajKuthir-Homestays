/**
 * The .ics feed the OTAs import. Moved out of routes/calendar.ts unchanged so
 * it can be tested without a database (book-pay-rules.test.ts checks that a
 * live payment hold reaches it). No imports on purpose.
 */

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

export function renderIcsFeed(
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
