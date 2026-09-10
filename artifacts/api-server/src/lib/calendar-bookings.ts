import { asc, eq } from "drizzle-orm";
import { db, bookings, type CalendarEvent } from "@workspace/db";

/**
 * Bringing ledger bookings onto the availability calendar.
 *
 * The two have always been separate tables: `calendar_events` holds what the
 * OTA iCal feeds return plus blocks added by hand, while `bookings` holds the
 * money ledger. Nothing joined them, so a stay typed into the ledger left the
 * public calendar advertising those nights as free — the exact hole that
 * causes double bookings.
 *
 * This merges at READ time rather than writing a calendar row whenever a
 * booking is saved. Dual writes drift: an edited booking leaves a stale block
 * behind, a deleted one leaves a phantom, and the two tables disagree forever
 * after. Merging on read means each table keeps exactly one job and they can
 * never fall out of step.
 */

/** Where a calendar entry came from, so the UI knows what it may edit. */
export type MergedEvent = CalendarEvent & { origin: "event" | "booking" };

/** Half-open overlap: a stay ending on the 5th does not clash with one starting on the 5th. */
export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Confirmed bookings as calendar entries.
 *
 * A booking is skipped when a calendar event FROM THE SAME SOURCE already
 * covers overlapping nights: that is the same reservation arriving twice, once
 * through the OTA's feed and once through the ledger. When a feed is dead —
 * MakeMyTrip's has been for weeks — nothing covers it and the ledger booking
 * fills the gap, which is the point of the exercise.
 */
export async function bookingsAsEvents(
  existing: Array<Pick<CalendarEvent, "source" | "startDate" | "endDate">>,
  excludeSource?: CalendarEvent["source"],
): Promise<MergedEvent[]> {
  const rows = await db
    .select()
    .from(bookings)
    .where(eq(bookings.status, "confirmed"))
    .orderBy(asc(bookings.checkIn));

  const out: MergedEvent[] = [];

  for (const booking of rows) {
    // Never echo an OTA's own reservations back into the feed it reads.
    if (excludeSource && booking.source === excludeSource) continue;

    const alreadyOnCalendar = existing.some(
      (event) =>
        event.source === booking.source &&
        rangesOverlap(
          event.startDate,
          event.endDate,
          booking.checkIn,
          booking.checkOut,
        ),
    );

    if (alreadyOnCalendar) continue;

    out.push({
      // Stable and distinguishable from a real calendar_events row, so a
      // delete request for one can never match the other. It also fails the
      // isUuid() guard on the block routes, which is a second line of defence.
      id: `${booking.id}-booking`,
      source: booking.source,
      externalUid: null,
      startDate: booking.checkIn,
      endDate: booking.checkOut,
      status: "confirmed",
      title: booking.guestName ? `Booked — ${booking.guestName}` : "Booked",
      note: null,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
      origin: "booking",
    });
  }

  return out;
}

/** Merge and order by start date, so the calendar reads as one list. */
export function mergeByDate(
  events: CalendarEvent[],
  derived: MergedEvent[],
): MergedEvent[] {
  const all: MergedEvent[] = [
    ...events.map((event) => ({ ...event, origin: "event" as const })),
    ...derived,
  ];

  return all.sort((a, b) => a.startDate.localeCompare(b.startDate));
}
