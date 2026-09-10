import { desc, sql } from "drizzle-orm";
import { normaliseReference } from "./booking-reference";
import { db, bookings } from "@workspace/db";

/**
 * Looking a guest up by the Raj Kuthir reference on their confirmation message.
 *
 * This used to match the CHANNEL's booking number, which is not a secret — it
 * travels in confirmation emails and forwarded screenshots. It now matches the
 * reference we issue ourselves: five random characters from a 30-character
 * alphabet behind a date prefix, so 24 million possibilities per check-in date.
 *
 * Two things still back that up, because a credential should never rest on one:
 *
 *  1. The pack stops resolving after check-out (see `todayInIndia` below), so a
 *     reference from an old stay opens nothing.
 *  2. The route rate-limits attempts per IP, so the space cannot be walked.
 */

export type GuestBooking = {
  reference: string;
  guestName: string | null;
  checkIn: string;
  checkOut: string;
  guests: number | null;
  source: string;
};

export type LookupResult =
  | { ok: true; booking: GuestBooking }
  | { ok: false; reason: "not_found" | "ended" | "cancelled" };

/**
 * Today's date in the house's own timezone. The server runs in UTC, and
 * between midnight and 05:30 IST a UTC date is still on the previous day —
 * which would quietly extend every stay by a few hours. Cheap to get right.
 */
export function todayInIndia(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Minimum length worth a database round-trip. */
export const MIN_REFERENCE_LENGTH = 4;

export async function lookupBooking(
  rawReference: string,
  today = todayInIndia(),
): Promise<LookupResult> {
  const reference = normaliseReference(rawReference);

  if (reference.length < MIN_REFERENCE_LENGTH) {
    return { ok: false, reason: "not_found" };
  }

  // Matched against Raj Kuthir's OWN reference, not the channel's number. The
  // channel number travels in confirmation emails and is not secret; the Raj
  // Kuthir reference is random and is issued precisely to be the guest's key.
  const normalisedColumn = sql`upper(regexp_replace(${bookings.reference}, '[^A-Za-z0-9]', '', 'g'))`;

  const rows = await db
    .select({
      reference: bookings.reference,
      guestName: bookings.guestName,
      checkIn: bookings.checkIn,
      checkOut: bookings.checkOut,
      guests: bookings.guests,
      source: bookings.source,
      status: bookings.status,
    })
    .from(bookings)
    .where(sql`${normalisedColumn} = ${reference}`)
    // Latest stay first, so a repeat guest reusing a reference gets the
    // current one rather than a stay from two years ago.
    .orderBy(desc(bookings.checkOut))
    .limit(5);

  if (rows.length === 0) return { ok: false, reason: "not_found" };

  const live = rows.filter((row) => row.status !== "cancelled");
  if (live.length === 0) return { ok: false, reason: "cancelled" };

  // Valid through the check-out day itself: the guest is still in the house on
  // the morning they leave, and that is exactly when they want the caretaker's
  // number. `checkOut` is exclusive everywhere else in this codebase, so this
  // is deliberately one day more generous than a half-open comparison.
  const current = live.find((row) => today <= row.checkOut);
  if (!current) return { ok: false, reason: "ended" };

  return {
    ok: true,
    booking: {
      reference,
      guestName: current.guestName,
      checkIn: current.checkIn,
      checkOut: current.checkOut,
      guests: current.guests,
      source: current.source,
    },
  };
}
