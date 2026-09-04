import { desc, sql } from "drizzle-orm";
import { db, bookings } from "@workspace/db";

/**
 * Looking a guest up by the reservation number on their confirmation.
 *
 * The reference is unique, but it is NOT a secret — it travels in confirmation
 * emails, OTA dashboards and forwarded screenshots. Two things keep that from
 * mattering:
 *
 *  1. The pack stops resolving after check-out (see `todayInIndia` below), so a
 *     reference from an old stay opens nothing.
 *  2. The route rate-limits attempts per IP, so the reference space cannot be
 *     walked.
 *
 * The people who typically see a booking confirmation are the guest's own
 * travelling party — which is exactly who the arrival pack is for.
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
 * Strips everything that is not a letter or digit and upper-cases the rest, so
 * "hm abc-1234", "HMABC1234" and "HM-ABC 1234" are the same reference. Applied
 * identically to the stored value in SQL below.
 */
export function normaliseReference(raw: string): string {
  return raw.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

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

  // Same normalisation on the stored column: the owner may have typed the
  // reference with spaces or dashes when entering an offline booking.
  const normalisedColumn = sql`upper(regexp_replace(${bookings.externalRef}, '[^A-Za-z0-9]', '', 'g'))`;

  const rows = await db
    .select({
      externalRef: bookings.externalRef,
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
