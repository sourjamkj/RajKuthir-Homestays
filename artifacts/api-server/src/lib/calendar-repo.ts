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
    await transaction
      .delete(calendarEvents)
      .where(eq(calendarEvents.source, source));

    if (events.length === 0) return 0;

    const rows: NewCalendarEvent[] = events.map((event) => ({
      source,
      externalUid: event.externalUid,
      startDate: event.startDate,
      endDate: event.endDate,
      title: event.title ?? "Reserved",
      status: "confirmed",
    }));

    await transaction.insert(calendarEvents).values(rows);
    return rows.length;
  });
}