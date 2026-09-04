import { and, asc, eq, lte, sql } from "drizzle-orm";
import {
  db,
  bookings,
  guestContacts,
  whatsappMessages,
  normalisePhone,
  type Booking,
  type WhatsappMessage,
} from "@workspace/db";

export type QueueInput = {
  bookingId: string;
  kind: WhatsappMessage["kind"];
  toPhone: string;
  templateName: string;
  templateParams: string[];
  preview: string;
  sendAfter: Date;
  status: "draft" | "pending";
};

/**
 * Queues a message, or does nothing if this booking already has one of this
 * kind. The unique index on (booking_id, kind) is what makes that safe under
 * concurrent scheduler runs — we let the database decide, rather than
 * checking first and racing.
 */
export async function queueMessage(input: QueueInput): Promise<boolean> {
  const inserted = await db
    .insert(whatsappMessages)
    .values({ ...input, updatedAt: new Date() })
    .onConflictDoNothing({
      target: [whatsappMessages.bookingId, whatsappMessages.kind],
    })
    .returning({ id: whatsappMessages.id });

  return inserted.length > 0;
}

/** Messages that are ready to go out right now, oldest first. */
export async function claimDueMessages(
  limit: number,
  now = new Date(),
): Promise<WhatsappMessage[]> {
  return db
    .select()
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.status, "pending"),
        lte(whatsappMessages.sendAfter, now),
      ),
    )
    .orderBy(asc(whatsappMessages.sendAfter))
    .limit(limit);
}

export async function markSent(
  id: string,
  providerMessageId: string,
): Promise<void> {
  await db
    .update(whatsappMessages)
    .set({
      status: "sent",
      providerMessageId,
      sentAt: new Date(),
      error: null,
      attempts: sql`${whatsappMessages.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(whatsappMessages.id, id));
}

/**
 * Records a failure. A retryable error goes back to `pending` with an
 * exponential backoff; anything else, or too many tries, is terminal so the
 * queue cannot spin forever on a number that will never accept a message.
 */
export async function markFailed(
  id: string,
  error: string,
  retryable: boolean,
  attempts: number,
  maxAttempts: number,
): Promise<void> {
  const giveUp = !retryable || attempts + 1 >= maxAttempts;
  const backoffMs = Math.min(2 ** attempts, 32) * 60_000;

  await db
    .update(whatsappMessages)
    .set({
      status: giveUp ? "failed" : "pending",
      error: error.slice(0, 500),
      attempts: attempts + 1,
      sendAfter: giveUp ? undefined : new Date(Date.now() + backoffMs),
      updatedAt: new Date(),
    })
    .where(eq(whatsappMessages.id, id));
}

/** Bookings that might be due a message: confirmed, and not long past. */
export async function bookingsNeedingMessages(
  fromDate: string,
  toDate: string,
): Promise<Booking[]> {
  return db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.status, "confirmed"),
        sql`${bookings.checkOut} >= ${fromDate}`,
        sql`${bookings.checkIn} <= ${toDate}`,
      ),
    );
}

/**
 * True when this guest has asked not to receive marketing. Unknown numbers
 * are treated as not opted out — they have simply never been recorded — but
 * see `notifications.ts` for why marketing still needs a positive signal.
 */
export async function hasOptedOutOfMarketing(
  phone: string | null,
): Promise<boolean> {
  const key = normalisePhone(phone);
  if (!key) return true;

  const [row] = await db
    .select({ optOut: guestContacts.marketingOptOut })
    .from(guestContacts)
    .where(eq(guestContacts.phone, key))
    .limit(1);

  return row?.optOut ?? false;
}

export async function listRecentMessages(limit = 100): Promise<WhatsappMessage[]> {
  return db
    .select()
    .from(whatsappMessages)
    .orderBy(sql`${whatsappMessages.createdAt} desc`)
    .limit(limit);
}

export async function setMessageStatus(
  id: string,
  status: "pending" | "cancelled",
): Promise<WhatsappMessage | null> {
  const [updated] = await db
    .update(whatsappMessages)
    .set({ status, updatedAt: new Date() })
    .where(eq(whatsappMessages.id, id))
    .returning();

  return updated ?? null;
}
