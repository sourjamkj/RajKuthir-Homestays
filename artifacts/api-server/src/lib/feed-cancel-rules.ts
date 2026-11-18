/**
 * An OTA booking whose reservation has vanished from that OTA's calendar feed
 * was cancelled there. We only trust a vanishing we saw happen: a feed event
 * that overlapped the booking was removed in this sync, and nothing in the
 * new feed still covers it. Feeds that never list bookings never trigger this.
 */

type Range = { startDate: string; endDate: string };
type FeedBooking = { id: string; checkIn: string; checkOut: string };

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart < bEnd && bStart < aEnd;

export function bookingsGoneFromFeed(input: {
  /** Events this sync removed from the source. */
  removed: Range[];
  /** The whole new feed for the source. */
  feed: Range[];
  /** Confirmed bookings from the same source. */
  bookings: FeedBooking[];
  /** Events added in this sync: a moved reservation looks like remove + add. */
  addedCount: number;
  today: string;
}): FeedBooking[] {
  // shortcut: a date change on the OTA shows up as one event removed and one added; we
  // leave those to the change email and the owner rather than guess which is which.
  if (input.addedCount > 0) return [];
  return input.bookings.filter(
    (b) =>
      b.checkOut > input.today &&
      input.removed.some((e) => overlaps(e.startDate, e.endDate, b.checkIn, b.checkOut)) &&
      !input.feed.some((e) => overlaps(e.startDate, e.endDate, b.checkIn, b.checkOut)),
  );
}
