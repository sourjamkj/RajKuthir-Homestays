import { and, asc, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  bookings,
  calendarEvents,
  type CalendarEvent,
  type NewCalendarEvent,
} from "@workspace/db";
import {
  bookingsAsEvents,
  mergeByDate,
  rangesOverlap,
  type MergedEvent,
} from "./calendar-bookings";
import { readLiveHolds } from "./book-pay-repo";
import { holdsAsEvents } from "./book-pay-rules";

export type CalendarSource = CalendarEvent["source"];

export const OWNED_SOURCES: CalendarSource[] = ["manual", "direct"];

/**
 * Everything occupying a night, from either table. Confirmed ledger bookings
 * are folded in here rather than stored as calendar rows — see calendar-bookings.
 *
 * Calendar events that correspond to a confirmed booking (same source and
 * overlapping dates) get their title overridden to "Booked — GuestName" so the
 * admin dashboard counts them as stays, not blocked periods.  Without this,
 * OTA feeds that label reservations "Not available" or "Closed" would cause
 * the dashboard to show 0 upcoming bookings.
 */
export async function listAllEvents(): Promise<MergedEvent[]> {
  const events = await db
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.status, "confirmed"))
    .orderBy(asc(calendarEvents.startDate));

  const merged = mergeByDate(events, await bookingsAsEvents(events));

  // Calendar events whose dates are already covered by a ledger booking were
  // NOT emitted by bookingsAsEvents (dedup). Their OTA-assigned title ("Not
  // available", "Closed") makes the frontend's isBlock() hide them from the
  // booking count.  Fix that here by cross-referencing the bookings table and
  // stamping the guest name on any match.
  const confirmedBookings = await db
    .select({
      source: bookings.source,
      checkIn: bookings.checkIn,
      checkOut: bookings.checkOut,
      guestName: bookings.guestName,
    })
    .from(bookings)
    .where(eq(bookings.status, "confirmed"));

  for (const entry of merged) {
    if (entry.origin !== "event") continue;
    const match = confirmedBookings.find(
      (b) =>
        b.source === entry.source &&
        rangesOverlap(entry.startDate, entry.endDate, b.checkIn, b.checkOut),
    );
    if (match) {
      entry.title = match.guestName
        ? `Booked — ${match.guestName}`
        : "Booked";
      entry.origin = "booking";
    }
  }

  return merged;
}

/**
 * What a guest sees as unavailable. Includes ledger bookings: a night you have
 * already sold must never show as free, whichever table it was recorded in.
 * Dates only — no guest names or sources reach the public endpoint.
 */
export async function listPublicBlocks(): Promise<
  Array<{ startDate: string; endDate: string }>
> {
  const events = await db
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.status, "confirmed"))
    .orderBy(asc(calendarEvents.startDate));

  // Live Book & Pay holds too: a guest paying right now must not see the
  // same nights offered to someone else. readLiveHolds never throws.
  const derived = [
    ...(await bookingsAsEvents(events)),
    ...holdsAsEvents(await readLiveHolds()),
  ];

  return mergeByDate(events, derived).map((entry) => ({
    startDate: entry.startDate,
    endDate: entry.endDate,
  }));
}

/**
 * The .ics we publish to the OTAs. This is the one that actually prevents
 * double bookings, so ledger bookings belong in it above all: a stay taken
 * over WhatsApp has to reach Booking.com and Airbnb somehow, and this feed is
 * the only channel that does it.
 *
 * `excludeSource` keeps us from echoing a channel's own reservations back at
 * it, and applies to bookings as well as calendar rows.
 */
export async function listFeedEvents(
  excludeSource?: CalendarSource,
): Promise<MergedEvent[]> {
  const where = excludeSource
    ? and(
        eq(calendarEvents.status, "confirmed"),
        ne(calendarEvents.source, excludeSource),
      )
    : eq(calendarEvents.status, "confirmed");

  const events = await db
    .select()
    .from(calendarEvents)
    .where(where)
    .orderBy(asc(calendarEvents.startDate));

  // Live Book & Pay holds go to every OTA: while a guest is paying, Airbnb
  // and Booking.com must not sell the same nights. They are "direct", so no
  // channel ever has them excluded as its own echo.
  const derived = [
    ...(await bookingsAsEvents(events, excludeSource)),
    ...holdsAsEvents(await readLiveHolds()),
  ];

  return mergeByDate(events, derived);
}

export async function createManualBlock(input: {
  startDate: string;
  endDate: string;
  title?: string | null;
  note?: string | null;
}): Promise<CalendarEvent> {
  const [row] = await db
    .insert(calendarEvents)
    .values({
      source: "manual",
      externalUid: null,
      startDate: input.startDate,
      endDate: input.endDate,
      title: input.title ?? "Blocked by host",
      note: input.note ?? null,
      status: "confirmed",
    })
    .returning();

  return row;
}

export async function deleteOwnedEvent(id: string): Promise<boolean> {
  const deleted = await db
    .delete(calendarEvents)
    .where(
      and(
        eq(calendarEvents.id, id),
        inArray(calendarEvents.source, OWNED_SOURCES),
      ),
    )
    .returning({ id: calendarEvents.id });

  return deleted.length > 0;
}

/**
 * Makes the stored rows for one OTA match its feed, touching only what changed.
 *
 * This used to delete every row for the source and insert the feed afresh on
 * each poll. That kept the calendar right but gave every event a new id and a
 * new created_at every two hours, so the activity bell announced the same
 * Airbnb block as "new" all day long. Rows are now matched on the feed's UID
 * (falling back to the date range for feeds without stable UIDs): a match is
 * kept, id and created_at intact, with only its dates or title updated; an
 * event no longer in the feed is deleted; only a genuinely new one is inserted.
 */
export async function replaceSourceEvents(
  source: Exclude<CalendarSource, "manual" | "direct">,
  events: Array<{
    externalUid: string;
    startDate: string;
    endDate: string;
    title?: string | null;
  }>,
): Promise<number> {
  return db.transaction(async (transaction) => {
    const existing = await transaction
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.source, source));

    const byUid = new Map(existing.map((row) => [row.externalUid, row]));
    const byRange = new Map(
      existing.map((row) => [`${row.startDate}:${row.endDate}`, row]),
    );
    const kept = new Set<string>();
    const fresh: NewCalendarEvent[] = [];

    for (const event of events) {
      const title = event.title ?? "Reserved";
      const candidate =
        byUid.get(event.externalUid) ??
        byRange.get(`${event.startDate}:${event.endDate}`);
      const match = candidate && !kept.has(candidate.id) ? candidate : null;

      if (match) {
        kept.add(match.id);
        if (
          match.externalUid !== event.externalUid ||
          match.startDate !== event.startDate ||
          match.endDate !== event.endDate ||
          match.title !== title ||
          match.status !== "confirmed"
        ) {
          await transaction
            .update(calendarEvents)
            .set({
              externalUid: event.externalUid,
              startDate: event.startDate,
              endDate: event.endDate,
              title,
              status: "confirmed",
            })
            .where(eq(calendarEvents.id, match.id));
        }
        continue;
      }

      fresh.push({
        source,
        externalUid: event.externalUid,
        startDate: event.startDate,
        endDate: event.endDate,
        title,
        status: "confirmed",
      });
    }

    const gone = existing
      .filter((row) => !kept.has(row.id))
      .map((row) => row.id);
    if (gone.length > 0) {
      await transaction
        .delete(calendarEvents)
        .where(inArray(calendarEvents.id, gone));
    }

    if (fresh.length > 0) {
      await transaction.insert(calendarEvents).values(fresh);
    }

    return events.length;
  });
}
