import type { Booking, Enquiry } from "@workspace/db";

import {
  CONVERSION_MESSAGES,
  draftBookingFromEnquiry,
  type ConversionRefusal,
} from "./enquiry-conversion";
import { linkEnquiryToBooking } from "./enquiries-repo";
import { createBooking, findClashes, type Clash } from "./ledger-repo";
import { logger } from "./logger";

/**
 * The body of POST /enquiries/:id/convert, lifted out so the Book & Pay
 * "Confirm" button runs exactly the same conversion rather than a copy.
 * Behaviour of the existing route is unchanged.
 */

export type ConvertOutcome =
  | { ok: true; booking: Booking; enquiry: Enquiry | null }
  | {
      ok: false;
      status: 409 | 422;
      error: string;
      reason: ConversionRefusal | Clash["kind"];
      bookingId?: string | null;
      clashes?: Array<{
        id: string;
        kind: Clash["kind"];
        reference: string | null;
        checkIn: string;
        checkOut: string;
      }>;
    };

export async function convertEnquiry(
  enquiry: Enquiry,
  options: { reference?: string | null } = {},
): Promise<ConvertOutcome> {
  const drafted = draftBookingFromEnquiry(enquiry);

  if (!drafted.ok) {
    return {
      ok: false,
      // 409 for the one that is a state problem rather than a data problem.
      status: drafted.reason === "already_converted" ? 409 : 422,
      error: CONVERSION_MESSAGES[drafted.reason],
      reason: drafted.reason,
      ...(drafted.reason === "already_converted"
        ? { bookingId: enquiry.convertedBookingId }
        : {}),
    };
  }

  /*
    Re-check the dates NOW, not as they were when the enquiry arrived.
    findClashes only counts confirmed bookings, so a pending row does not
    stand in the way.
  */
  const clashes = await findClashes({
    checkIn: drafted.draft.checkIn,
    checkOut: drafted.draft.checkOut,
    guestName: drafted.draft.guestName,
  });

  if (clashes.length > 0) {
    const clash = clashes[0]!;
    logger.warn(
      { enquiryId: enquiry.id, kind: clash.kind, bookingId: clash.booking.id },
      "Refused to convert an enquiry over existing dates",
    );
    return {
      ok: false,
      status: 409,
      error:
        clash.kind === "duplicate"
          ? "There is already a booking for this guest on these exact dates."
          : `Those dates now clash with an existing booking (${clash.booking.checkIn} to ${clash.booking.checkOut}). Move the dates or cancel the other booking first.`,
      reason: clash.kind,
      clashes: clashes.map((item) => ({
        id: item.booking.id,
        kind: item.kind,
        reference: item.booking.reference,
        checkIn: item.booking.checkIn,
        checkOut: item.booking.checkOut,
      })),
    };
  }

  // createBooking issues the RK- reference unless one was reserved already
  // (Book & Pay reserves it so it can travel as the UPI transaction note).
  const booking = await createBooking({
    ...drafted.draft,
    ...(options.reference ? { reference: options.reference } : {}),
  });

  const updated = await linkEnquiryToBooking(enquiry.id, booking.id);

  // No guest name or phone in this line — logs get shipped, read and kept.
  logger.info(
    { enquiryId: enquiry.id, bookingId: booking.id, status: booking.status },
    "Enquiry converted to a booking",
  );

  return { ok: true, booking, enquiry: updated };
}
