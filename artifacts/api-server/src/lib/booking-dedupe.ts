import { and, eq, gte, inArray, ne } from "drizzle-orm";
import { bookings, db, enquiries, pool, type Booking } from "@workspace/db";

import { logger } from "./logger";
import { HOLD_HOURS } from "./enquiry-hold";
import { findClashes } from "./ledger-repo";
import {
  duplicateGroups,
  survivorFor,
  unpaidToRelease,
  type BookingLite,
} from "./booking-dedupe-rules";

/**
 * The database half of booking-dedupe-rules.ts: releasing unpaid bookings
 * back to enquiries, and folding a duplicate booking into the one that stays.
 */

/**
 * Bookings the owner has named as duplicates. Each is merged into the other
 * copy of the same stay — only if that other copy exists, so a mistaken
 * entry here can never delete a stay outright. Once merged the reference no
 * longer exists, so the fix is a no-op on every later start.
 */
const NAMED_DUPLICATES = ["RK-16NOV-KK79J"];

function lite(row: Booking, hasOnboarding = false): BookingLite {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    source: row.source,
    guestName: row.guestName,
    guestPhone: row.guestPhone,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    receivedPaise: row.receivedPaise,
    createdAt: row.createdAt,
    hasOnboarding,
  };
}

async function withOnboarding(rows: Booking[]): Promise<BookingLite[]> {
  if (!rows.length) return [];
  let onboarded = new Set<string>();
  try {
    const { rows: found } = await pool.query<{ booking_id: string }>(
      "SELECT booking_id FROM guest_onboarding WHERE booking_id = ANY($1::uuid[])",
      [rows.map((row) => row.id)],
    );
    onboarded = new Set(found.map((row) => row.booking_id));
  } catch {
    // Guest tables missing: nobody has onboarding.
  }
  return rows.map((row) => lite(row, onboarded.has(row.id)));
}

/** Existing, not-cancelled bookings overlapping these nights — for conversion. */
export async function bookingsOverlapping(checkIn: string, checkOut: string): Promise<BookingLite[]> {
  const rows = await db.select().from(bookings).where(ne(bookings.status, "cancelled"));
  return withOnboarding(rows.filter((row) => row.checkIn < checkOut && row.checkOut > checkIn));
}

/**
 * Takes a booking out of the bookings table and leaves it as an enquiry.
 * The enquiry it came from goes back to "closed" (the FK clears its link);
 * a booking that never had one gets an enquiry written from it, so the lead
 * is not lost.
 */
export async function releaseToEnquiry(bookingId: string, reason: string): Promise<boolean> {
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) return false;

  return db.transaction(async (tx) => {
    const linked = await tx
      .select({ id: enquiries.id })
      .from(enquiries)
      .where(eq(enquiries.convertedBookingId, bookingId));

    const note = `${reason} (was booking ${booking.reference ?? booking.id}).`;
    if (linked.length) {
      await tx
        .update(enquiries)
        .set({ status: "closed", convertedBookingId: null })
        .where(inArray(enquiries.id, linked.map((row) => row.id)));
    } else {
      await tx.insert(enquiries).values({
        name: booking.guestName?.trim() || "Guest",
        phone: booking.guestPhone ?? "",
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        adults: booking.guests,
        children: 0,
        pets: booking.pets,
        requests: note.slice(0, 1000),
        status: "closed",
        quotedTotalPaise: booking.grossPaise,
      });
    }

    await tx.delete(bookings).where(eq(bookings.id, bookingId));
    logger.info({ bookingId, reference: booking.reference, reason }, "Booking released back to an enquiry");
    return true;
  });
}

async function tableExists(client: { query: typeof pool.query }, name: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>("SELECT to_regclass($1) IS NOT NULL AS exists", [`public.${name}`]);
  return rows[0]?.exists ?? false;
}

/**
 * Folds `duplicateId` into `survivorId`, then deletes the duplicate.
 *
 * Nothing the guest already holds is lost: their pre-arrival link, uploaded
 * documents and party move to the surviving booking when it has none of its
 * own; enquiries, review requests and flags are re-pointed; money and
 * details only fill gaps on the survivor, never overwrite it.
 */
export async function mergeDuplicate(duplicateId: string, survivorId: string, reason: string): Promise<boolean> {
  if (duplicateId === survivorId) return false;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string; reference: string | null }>(
      "SELECT id, reference FROM bookings WHERE id = ANY($1::uuid[]) FOR UPDATE",
      [[duplicateId, survivorId]],
    );
    if (rows.length !== 2) {
      await client.query("ROLLBACK");
      return false;
    }
    const q = client.query.bind(client) as typeof pool.query;

    // Gaps on the survivor filled from the duplicate.
    await client.query(
      `UPDATE bookings s SET
         guest_name     = COALESCE(s.guest_name, d.guest_name),
         guest_phone    = COALESCE(s.guest_phone, d.guest_phone),
         guests         = COALESCE(s.guests, d.guests),
         pets           = COALESCE(s.pets, d.pets),
         gross_paise    = COALESCE(s.gross_paise, d.gross_paise),
         received_paise = COALESCE(s.received_paise, d.received_paise),
         note           = COALESCE(s.note, d.note),
         status         = CASE WHEN d.status = 'confirmed' THEN 'confirmed'::booking_status ELSE s.status END,
         updated_at     = now()
       FROM bookings d WHERE s.id = $1 AND d.id = $2`,
      [survivorId, duplicateId],
    );

    // One-per-booking rows: move only when the survivor has none.
    for (const table of ["guest_onboarding", "guest_management_access", "booking_issues"]) {
      if (!(await tableExists({ query: q }, table))) continue;
      await client.query(
        `UPDATE ${table} SET booking_id = $1 WHERE booking_id = $2
           AND NOT EXISTS (SELECT 1 FROM ${table} WHERE booking_id = $1)`,
        [survivorId, duplicateId],
      );
    }
    if (await tableExists({ query: q }, "guest_documents")) {
      await client.query("UPDATE guest_documents SET booking_id = $1 WHERE booking_id = $2", [survivorId, duplicateId]);
    }
    if (await tableExists({ query: q }, "booking_guests")) {
      await client.query(
        `UPDATE booking_guests SET booking_id = $1 WHERE booking_id = $2
           AND guest_id NOT IN (SELECT guest_id FROM booking_guests WHERE booking_id = $1)`,
        [survivorId, duplicateId],
      );
    }
    if (await tableExists({ query: q }, "whatsapp_messages")) {
      await client.query(
        `UPDATE whatsapp_messages SET booking_id = $1 WHERE booking_id = $2
           AND kind NOT IN (SELECT kind FROM whatsapp_messages WHERE booking_id = $1)`,
        [survivorId, duplicateId],
      );
      await client.query("DELETE FROM whatsapp_messages WHERE booking_id = $1", [duplicateId]);
    }
    for (const [table, column] of [
      ["wa_conversations", "assigned_booking_id"],
      ["google_reviews", "matched_booking_id"],
    ] as const) {
      if (await tableExists({ query: q }, table)) {
        await client.query(`UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2`, [survivorId, duplicateId]);
      }
    }
    await client.query(
      "UPDATE enquiries SET converted_booking_id = $1, status = 'converted' WHERE converted_booking_id = $2",
      [survivorId, duplicateId],
    );

    // Whatever is left on the duplicate (caretaker alert log, a second
    // onboarding when the survivor had its own) goes with it via CASCADE.
    await client.query("DELETE FROM bookings WHERE id = $1", [duplicateId]);
    await client.query("COMMIT");

    const duplicate = rows.find((row) => row.id === duplicateId);
    const survivor = rows.find((row) => row.id === survivorId);
    logger.info(
      { duplicate: duplicate?.reference, survivor: survivor?.reference, reason },
      "Duplicate booking merged",
    );
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    logger.error({ err: error, duplicateId, survivorId }, "Merging a duplicate booking failed");
    return false;
  } finally {
    client.release();
  }
}

export type HygieneResult = { released: string[]; merged: Array<{ duplicate: string; survivor: string }>; unresolved: string[] };

let running = false;

/**
 * Releases unpaid bookings whose hold has run out, merges exact duplicates,
 * and applies the owner's named duplicate fixes. Safe to run repeatedly.
 */
export async function runBookingHygiene(now = new Date()): Promise<HygieneResult> {
  const result: HygieneResult = { released: [], merged: [], unresolved: [] };
  if (running) return result;
  running = true;
  try {
    const since = new Date(now.getTime() - 400 * 86_400_000).toISOString().slice(0, 10);
    const load = async () =>
      withOnboarding(await db.select().from(bookings).where(and(ne(bookings.status, "cancelled"), gte(bookings.checkOut, since))));

    // 1. The owner's named duplicates.
    for (const reference of NAMED_DUPLICATES) {
      const rows = await load();
      const duplicate = rows.find((row) => row.reference === reference);
      if (!duplicate) continue;
      const survivor = survivorFor(duplicate, rows);
      if (!survivor) {
        result.unresolved.push(reference);
        logger.warn({ reference }, "Named duplicate has no other copy of the stay; left in place");
        continue;
      }
      if (await mergeDuplicate(duplicate.id, survivor.id, "Named as a duplicate by the owner")) {
        result.merged.push({ duplicate: reference, survivor: survivor.reference ?? survivor.id });
      }
    }

    // 2. Exact duplicates: same number, same dates, our own bookings.
    for (const group of duplicateGroups(await load())) {
      for (const duplicate of group.duplicates) {
        if (await mergeDuplicate(duplicate.id, group.survivor.id, "Same guest number and dates")) {
          result.merged.push({ duplicate: duplicate.reference ?? duplicate.id, survivor: group.survivor.reference ?? group.survivor.id });
        }
      }
    }

    // 3. Unpaid bookings past their hold go back to being enquiries — unless
    //    the advance was marked received on the enquiry after it was booked,
    //    in which case the booking is simply brought up to confirmed.
    const unpaid = unpaidToRelease(await load(), now, HOLD_HOURS);
    const paidLater = unpaid.length
      ? await db
          .select({ bookingId: enquiries.convertedBookingId, advance: enquiries.quotedAdvancePaise, paidAt: enquiries.advancePaidAt })
          .from(enquiries)
          .where(inArray(enquiries.convertedBookingId, unpaid.map((booking) => booking.id)))
      : [];
    const paidIds = new Map(
      paidLater.filter((row) => row.paidAt && row.bookingId).map((row) => [row.bookingId!, row.advance]),
    );
    for (const booking of unpaid) {
      if (paidIds.has(booking.id)) {
        const clashes = await findClashes({ checkIn: booking.checkIn, checkOut: booking.checkOut, excludeId: booking.id });
        if (clashes.length) {
          logger.warn({ reference: booking.reference }, "Paid pending booking overlaps a confirmed one; left for the owner");
          result.unresolved.push(booking.reference ?? booking.id);
          continue;
        }
        await db
          .update(bookings)
          .set({ status: "confirmed", receivedPaise: paidIds.get(booking.id) ?? null, updatedAt: now })
          .where(and(eq(bookings.id, booking.id), eq(bookings.status, "pending")));
        logger.info({ reference: booking.reference }, "Pending booking confirmed: its advance was marked received");
        continue;
      }
      if (await releaseToEnquiry(booking.id, "Released: no advance received within the hold")) {
        result.released.push(booking.reference ?? booking.id);
      }
    }

    if (result.released.length || result.merged.length || result.unresolved.length) {
      logger.info(result, "Booking hygiene");
    }
    return result;
  } catch (error) {
    logger.error({ err: error }, "Booking hygiene failed");
    return result;
  } finally {
    running = false;
  }
}

let started = false;

/** At boot and then hourly. */
export function startBookingHygiene(): void {
  if (started) return;
  started = true;
  setTimeout(() => void runBookingHygiene(), 45_000).unref?.();
  setInterval(() => void runBookingHygiene(), 60 * 60 * 1000).unref?.();
}
