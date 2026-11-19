/**
 * Every blocked night must be explained: by a booking, or by the owner's
 * reason. An OTA "not available" row is fine when it overlaps any confirmed
 * booking or owner block (it is that channel's copy of our closure); one that
 * overlaps nothing is a reservation we never recorded, or a closure made on
 * the OTA itself.
 */

export type AuditIssue = "no_booking" | "no_reason";
type Row = { id: string; source: string; origin: "event" | "booking"; startDate: string; endDate: string; title: string | null };
type Stay = { checkIn: string; checkOut: string };

const overlaps = (a: { s: string; e: string }, b: { s: string; e: string }) => a.s < b.e && b.s < a.e;
const DEFAULT_TITLE = "Blocked by host";

export function hasReason(title: string | null | undefined): boolean {
  const t = title?.trim() ?? "";
  return t.length >= 3 && t !== DEFAULT_TITLE;
}

export function auditCalendarRows(rows: Row[], bookings: Stay[], today: string): Map<string, AuditIssue> {
  const issues = new Map<string, AuditIssue>();
  const manual = rows.filter((r) => r.origin === "event" && r.source === "manual");
  for (const r of rows) {
    if (r.origin !== "event" || r.endDate <= today) continue;
    if (r.source === "manual") {
      if (!hasReason(r.title)) issues.set(r.id, "no_reason");
      continue;
    }
    const span = { s: r.startDate, e: r.endDate };
    const explained =
      bookings.some((b) => overlaps(span, { s: b.checkIn, e: b.checkOut })) ||
      manual.some((m) => overlaps(span, { s: m.startDate, e: m.endDate }));
    if (!explained) issues.set(r.id, "no_booking");
  }
  return issues;
}
