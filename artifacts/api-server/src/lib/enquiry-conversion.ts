/**
 * Turning a won enquiry into a booking.
 *
 * This is the step that was missing. An enquiry could be quoted, held for 24
 * hours and marked paid, and then nothing happened — the owner re-typed the
 * whole thing into the ledger by hand. Until a bookings row existed there was
 * no RK- reference, so no arrival pack at /welcome and no guest verification
 * either, because both key off that row.
 *
 * Like guest-verification-rules.ts, this file imports NOTHING. The mapping and
 * its refusals are the part worth testing, and a module that reaches for the
 * database cannot be tested without one.
 */

/** The enquiry fields this conversion actually reads. */
export type ConvertibleEnquiry = {
  id: string;
  name: string;
  phone: string;
  checkIn: string | null;
  checkOut: string | null;
  adults: number | null;
  children: number | null;
  pets: number | null;
  requests: string | null;
  quotedTotalPaise: number | null;
  quotedAdvancePaise: number | null;
  advancePaidAt: Date | string | null;
  convertedBookingId: string | null;
};

/** What createBooking needs, named exactly as BookingInput names it. */
export type BookingDraft = {
  source: "direct";
  guestName: string;
  guestPhone: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  pets: number | null;
  status: "confirmed" | "pending";
  grossPaise: number | null;
  commissionPaise: number;
  taxPaise: null;
  receivedPaise: number | null;
  note: string | null;
};

export type ConversionRefusal =
  | "already_converted"
  | "no_dates"
  | "dates_unreadable"
  | "not_a_stay"
  | "no_guest_count";

export type DraftResult =
  | { ok: true; draft: BookingDraft }
  | { ok: false; reason: ConversionRefusal };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether the advance is recorded as received.
 *
 * Accepts a string because the same row arrives parsed from the database in
 * one place and as JSON in another, and a truthy check on the string "null"
 * is the kind of thing that silently confirms an unpaid booking.
 */
export function advanceIsPaid(advancePaidAt: Date | string | null): boolean {
  if (advancePaidAt === null || advancePaidAt === undefined) return false;
  const when = advancePaidAt instanceof Date ? advancePaidAt : new Date(advancePaidAt);
  return !Number.isNaN(when.getTime());
}

/**
 * Builds the booking this enquiry should become, or says why it cannot.
 *
 * Refuses rather than guesses, in the same spirit as enquiry-quote.ts: a
 * booking invented from incomplete information blocks a real date in the
 * calendar, and that costs more than asking the owner to fill a gap in.
 */
export function draftBookingFromEnquiry(enquiry: ConvertibleEnquiry): DraftResult {
  // Idempotency first. Converting twice would put the same stay in the
  // calendar under two references, and the guest would be sent whichever the
  // owner happened to be looking at.
  if (enquiry.convertedBookingId) {
    return { ok: false, reason: "already_converted" };
  }

  if (!enquiry.checkIn || !enquiry.checkOut) {
    return { ok: false, reason: "no_dates" };
  }

  if (!ISO_DATE.test(enquiry.checkIn) || !ISO_DATE.test(enquiry.checkOut)) {
    return { ok: false, reason: "dates_unreadable" };
  }

  // Half-open, as everywhere else: check-out is exclusive, so it must be
  // strictly after check-in or there are no nights in the stay.
  if (enquiry.checkOut <= enquiry.checkIn) {
    return { ok: false, reason: "not_a_stay" };
  }

  // A child is a guest. Two adults and two children are a party of four —
  // the same rule party.ts prices by, and the figure the rate card is read
  // against. Counting only adults here would understate the stay.
  const adults = Math.max(0, Math.floor(enquiry.adults ?? 0));
  const children = Math.max(0, Math.floor(enquiry.children ?? 0));
  const guests = adults + children;

  if (guests < 1) {
    return { ok: false, reason: "no_guest_count" };
  }

  const paid = advanceIsPaid(enquiry.advancePaidAt);

  return {
    ok: true,
    draft: {
      // Not "manual", which is for walk-ins and offline bookings. This one
      // came through the website's own enquiry form.
      source: "direct",
      guestName: enquiry.name,
      guestPhone: enquiry.phone,
      checkIn: enquiry.checkIn,
      checkOut: enquiry.checkOut,
      guests,
      pets: enquiry.pets ?? null,

      /*
        A booking nobody has paid for is pending, not confirmed.

        This matters beyond bookkeeping: findClashes only counts confirmed
        bookings, so a pending row does not block the dates for anyone else.
        That is the right behaviour — the owner may want the booking on file
        while still chasing the advance, and should not have the calendar
        closed on the strength of an unpaid promise.
      */
      status: paid ? "confirmed" : "pending",

      /*
        What the guest was actually told, never a figure recomputed now. The
        rate plan may have moved since the quote went out; the promise did not.
        Null when no quote was ever sent — the owner fills it in rather than
        this code inventing a price.
      */
      grossPaise: enquiry.quotedTotalPaise,

      // A direct booking pays no channel commission. Zero is a true statement
      // here and keeps the ledger's sums honest; null would read as unknown.
      commissionPaise: 0,

      // Genuinely unknown at this point, so it stays unknown.
      taxPaise: null,

      // Only the advance has arrived, and only if it was marked received.
      receivedPaise: paid ? enquiry.quotedAdvancePaise : null,

      note: noteFor(enquiry),
    },
  };
}

/**
 * Carries the guest's own words across, and records where the booking came
 * from so a row in the ledger can be traced back to the enquiry that made it.
 */
function noteFor(enquiry: ConvertibleEnquiry): string | null {
  const parts: string[] = [`Converted from website enquiry ${enquiry.id}.`];
  const requests = enquiry.requests?.trim();
  if (requests) parts.push(`Guest requests: ${requests}`);
  return parts.join(" ").slice(0, 500);
}

/** What the owner is told when a conversion is refused. */
export const CONVERSION_MESSAGES: Record<ConversionRefusal, string> = {
  already_converted:
    "This enquiry has already been turned into a booking.",
  no_dates:
    "This enquiry has no dates, so there is nothing to put in the calendar. Add them first.",
  dates_unreadable:
    "The dates on this enquiry are not readable.",
  not_a_stay:
    "Check-out is not after check-in, so this is not a stay.",
  no_guest_count:
    "This enquiry has no guest count, and a booking needs one to be priced.",
};
