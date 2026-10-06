import { and, asc, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  calendarEvents,
  type CalendarEvent,
  type NewCalendarEvent,
} from "@workspace/db";
import {
  bookingsAsEvents,
  mergeByDate,
  type MergedEvent,
} from "./calendar-bookings";

export type CalendarSource = CalendarEvent["source"];

export const OWNED_SOURCES: CalendarSource[] = ["manual", "direct"];

/**
 * Everything occupying a night, from either table. Confirmed ledger bookings
 * are folded in here rather than stored as calendar rows — see calendar-bookings.
 */
export async function listAllEvents(): Promise<MergedEvent[]> {
  const events = await db
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.status, "confirmed"))
    .orderBy(asc(calendarEvents.startDate));

  return mergeByDate(events, await bookingsAsEvents(events));
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

  return mergeByDate(events, await bookingsAsEvents(events)).map((entry) => ({
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

  return mergeByDate(events, await bookingsAsEvents(events, excludeSource));
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
