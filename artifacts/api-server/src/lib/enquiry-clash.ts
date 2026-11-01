/**
 * Whether an open enquiry asks for nights that are already taken.
 *
 * The public form refuses taken dates before an enquiry is stored, but an
 * enquiry added by hand, or one whose dates were blocked after it arrived,
 * would otherwise still offer Send quote and Book, inviting the owner to
 * re-confirm nights that are gone. The card says so instead.
 *
 * Only open enquiries (new, contacted) are checked, and never one that has
 * already become a booking: its own booking would always "clash" with it.
 * Live Book & Pay holds are not in `taken` for the same reason.
 */

export type TakenEvent = {
  source: string;
  startDate: string;
  endDate: string;
  title?: string | null;
  origin?: "event" | "booking";
};

export type DatesTaken = { startDate: string; endDate: string; label: string };

const SOURCE_LABELS: Record<string, string> = {
  manual: "blocked by you",
  direct: "a direct booking",
  bookingCom: "Booking.com",
  airbnb: "Airbnb",
  makeMyTrip: "MakeMyTrip",
};

/** Half-open: a stay ending on the 5th does not clash with one starting on the 5th. */
const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart < bEnd && aEnd > bStart;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function datesTakenFor(
  enquiry: { status: string; checkIn: string | null; checkOut: string | null; convertedBookingId: string | null },
  taken: readonly TakenEvent[],
): DatesTaken | null {
  if (enquiry.status !== "new" && enquiry.status !== "contacted") return null;
  if (enquiry.convertedBookingId) return null;
  const { checkIn, checkOut } = enquiry;
  if (!checkIn || !checkOut || !ISO_DATE.test(checkIn) || !ISO_DATE.test(checkOut) || checkOut <= checkIn) return null;

  const hit = taken.find((event) => overlaps(checkIn, checkOut, event.startDate, event.endDate));
  if (!hit) return null;

  const booked = typeof hit.title === "string" && hit.title.startsWith("Booked") ? hit.title : null;
  const label = booked ?? SOURCE_LABELS[hit.source] ?? hit.source;
  return { startDate: hit.startDate, endDate: hit.endDate, label };
}
