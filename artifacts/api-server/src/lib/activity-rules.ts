/**
 * What counts as "new" in the owner console, and how it is worded.
 *
 * Pure functions only — no database — so the rules can be tested with
 * `node --test` like the other *-rules files. activity-repo.ts does the
 * querying and hands the rows to buildActivity().
 */

export type ActivityKind =
  | "booking_new"
  | "booking_cancelled"
  | "ota_block"
  | "enquiry_new"
  | "documents_uploaded";

export type ActivityItem = {
  /** Stable across requests, so the client can key and de-duplicate on it. */
  id: string;
  kind: ActivityKind;
  /** ISO timestamp of the moment it happened. */
  at: string;
  title: string;
  detail: string;
  /** Where in the console to deal with it. */
  href: string;
};

/** Never look back further than this, whatever the last-seen marker says. */
export const MAX_LOOKBACK_DAYS = 30;
/** First sign-in ever (no marker yet): show the last week, not the last month. */
export const FIRST_VISIT_LOOKBACK_DAYS = 7;
/** A single panel should stay readable. */
export const MAX_ITEMS = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The start of the "new since" window. Items strictly after this are new.
 *
 * A marker in the future (clock skew, a bad write) is treated as now, so it
 * can never hide activity indefinitely.
 */
export function activityWindowStart(seenAt: Date | null, now: Date): Date {
  const floor = new Date(now.getTime() - MAX_LOOKBACK_DAYS * DAY_MS);
  if (!seenAt || Number.isNaN(seenAt.getTime())) {
    return new Date(now.getTime() - FIRST_VISIT_LOOKBACK_DAYS * DAY_MS);
  }
  if (seenAt.getTime() > now.getTime()) return now;
  return seenAt.getTime() < floor.getTime() ? floor : seenAt;
}

/**
 * The marker to store when the owner marks everything read.
 *
 * The client sends the timestamp of the newest item it actually showed, not
 * "now": anything that arrived between the panel loading and the click stays
 * unread instead of being swallowed. Missing, invalid or future values fall
 * back to now.
 */
export function seenMarker(upTo: unknown, now: Date): Date {
  if (typeof upTo !== "string") return now;
  const parsed = new Date(upTo);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime()) return now;
  return parsed;
}

const SOURCE_LABELS: Record<string, string> = {
  manual: "Offline",
  direct: "Direct",
  bookingCom: "Booking.com",
  airbnb: "Airbnb",
  makeMyTrip: "MakeMyTrip",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/** "2026-10-03" -> "3 Oct". Dates are calendar dates, so no timezone maths. */
export function shortDate(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "?";
  const [, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]}`;
}

function stay(checkIn: string | null, checkOut: string | null): string {
  return checkIn && checkOut ? `${shortDate(checkIn)} → ${shortDate(checkOut)}` : "dates not given";
}

export type ActivityRows = {
  newBookings: Array<{ id: string; source: string; guestName: string | null; guestPhone: string | null; checkIn: string; checkOut: string; createdAt: Date }>;
  cancelledBookings: Array<{ id: string; source: string; guestName: string | null; checkIn: string; checkOut: string; updatedAt: Date }>;
  otaBlocks: Array<{ id: string; source: string; startDate: string; endDate: string; createdAt: Date }>;
  enquiries: Array<{ id: string; name: string; checkIn: string | null; checkOut: string | null; createdAt: Date }>;
  uploads: Array<{ bookingId: string; guestName: string | null; checkIn: string; completedAt: Date }>;
};

/** Turns the raw rows into one newest-first list. */
export function buildActivity(rows: ActivityRows): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const b of rows.newBookings) {
    items.push({
      id: `booking_new:${b.id}`,
      kind: "booking_new",
      at: b.createdAt.toISOString(),
      title: `New ${sourceLabel(b.source)} booking`,
      detail:
        `${b.guestName ?? "Unnamed guest"} · ${stay(b.checkIn, b.checkOut)}` +
        (b.guestPhone ? "" : " · no phone number yet"),
      href: "/admin/guests",
    });
  }

  for (const b of rows.cancelledBookings) {
    items.push({
      id: `booking_cancelled:${b.id}:${b.updatedAt.toISOString()}`,
      kind: "booking_cancelled",
      at: b.updatedAt.toISOString(),
      title: `${sourceLabel(b.source)} booking cancelled`,
      detail: `${b.guestName ?? "Unnamed guest"} · ${stay(b.checkIn, b.checkOut)}`,
      href: "/admin/earnings",
    });
  }

  for (const e of rows.otaBlocks) {
    items.push({
      id: `ota_block:${e.id}`,
      kind: "ota_block",
      at: e.createdAt.toISOString(),
      title: `${sourceLabel(e.source)} blocked dates`,
      detail: `${stay(e.startDate, e.endDate)} · from the ${sourceLabel(e.source)} calendar feed`,
      href: "/admin",
    });
  }

  for (const q of rows.enquiries) {
    items.push({
      id: `enquiry_new:${q.id}`,
      kind: "enquiry_new",
      at: q.createdAt.toISOString(),
      title: "New website enquiry",
      detail: `${q.name} · ${stay(q.checkIn, q.checkOut)}`,
      href: "/admin/guests",
    });
  }

  for (const u of rows.uploads) {
    items.push({
      id: `documents_uploaded:${u.bookingId}:${u.completedAt.toISOString()}`,
      kind: "documents_uploaded",
      at: u.completedAt.toISOString(),
      title: "Guest ID documents uploaded",
      detail: `${u.guestName ?? "Unnamed guest"} · arriving ${shortDate(u.checkIn)}`,
      href: "/admin/guests",
    });
  }

  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, MAX_ITEMS);
}
