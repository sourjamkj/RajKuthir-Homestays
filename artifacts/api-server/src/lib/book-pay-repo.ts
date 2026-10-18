import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  appSettings,
  bookings,
  calendarEvents,
  db,
  enquiries,
  paymentEvents,
  paymentRequests,
  type Enquiry,
  type PaymentRequest,
} from "@workspace/db";

import type { DateRange } from "./availability";
import {
  DEFAULT_BOOK_PAY_SETTINGS,
  extendedHold,
  hashPayToken,
  isNotMigrated,
  isUniqueViolation,
  liveHoldRanges,
  parseSettings,
  type BookPaySettings,
  type HoldRow,
} from "./book-pay-rules";
import type { HoldRecord, StartStore } from "./book-pay-start";
import { logger } from "./logger";

/**
 * Database side of Book & Pay. Every decision is in book-pay-rules.ts; this
 * file only reads and writes.
 */

const SETTINGS_KEY = "book_pay.settings";

/**
 * Arbitrary constant for pg_advisory_xact_lock. Every /book/start takes the
 * same lock, so holds are created strictly one at a time. Bookings arrive a
 * few times a week; serialising them costs nothing and removes the race.
 */
const START_LOCK_KEY = 7_302_026;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export { isNotMigrated, isUniqueViolation };

/* ------------------------------- settings ------------------------------ */

export async function getBookPaySettings(): Promise<BookPaySettings> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, SETTINGS_KEY));
  return row ? parseSettings(row.value) : DEFAULT_BOOK_PAY_SETTINGS;
}

export async function saveBookPaySettings(settings: BookPaySettings): Promise<void> {
  const value = JSON.stringify(settings);
  await db
    .insert(appSettings)
    .values({ key: SETTINGS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

/* ---------------------------- holds and dates -------------------------- */

async function holdRows(executor: Executor): Promise<HoldRow[]> {
  const rows = await executor
    .select({
      id: paymentRequests.id,
      status: paymentRequests.status,
      holdExpiresAt: paymentRequests.holdExpiresAt,
      checkIn: enquiries.checkIn,
      checkOut: enquiries.checkOut,
    })
    .from(paymentRequests)
    .innerJoin(enquiries, eq(enquiries.id, paymentRequests.enquiryId))
    .where(inArray(paymentRequests.status, ["awaiting_payment", "submitted"]));

  return rows.filter(
    (row): row is HoldRow => row.checkIn !== null && row.checkOut !== null,
  );
}

/**
 * Live self-serve holds as date ranges, for the public calendar and the
 * iCal feed the OTAs read.
 *
 * NEVER throws. These ranges are added to the availability feed and the OTA
 * export; if this table is missing (migration not run yet) or the query
 * fails, the right answer is "no holds", not a broken calendar for every
 * channel. The failure is logged.
 */
export async function readLiveHolds(now = new Date()): Promise<Array<DateRange & { id: string }>> {
  try {
    return liveHoldRanges(await holdRows(db), now);
  } catch (error) {
    if (isNotMigrated(error)) return [];
    logger.error({ err: error }, "Could not read Book & Pay holds; treating as none");
    return [];
  }
}

/** Everything a new guest cannot book over, read through the given executor. */
async function takenRanges(executor: Executor, now: Date): Promise<DateRange[]> {
  const [events, confirmed, holds] = await Promise.all([
    executor
      .select({ startDate: calendarEvents.startDate, endDate: calendarEvents.endDate })
      .from(calendarEvents)
      .where(eq(calendarEvents.status, "confirmed")),
    executor
      .select({ startDate: bookings.checkIn, endDate: bookings.checkOut })
      .from(bookings)
      .where(eq(bookings.status, "confirmed")),
    holdRows(executor),
  ]);

  return [...events, ...confirmed, ...liveHoldRanges(holds, now)];
}

/** The Postgres-backed store for startHold: one transaction, one lock. */
export const pgStartStore: StartStore<Tx> = {
  withLock(work) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${START_LOCK_KEY})`);
      return work(tx);
    });
  },

  takenRanges(tx, now) {
    return takenRanges(tx, now);
  },

  async createHold(tx, record: HoldRecord) {
    const { input } = record;

    // The enquiry is the same row the owner-led flow uses: quoted, "contacted",
    // with quote_sent_at as the start of its hold. Nothing new to learn.
    const [enquiry] = await tx
      .insert(enquiries)
      .values({
        name: input.name,
        phone: input.phone,
        email: input.email,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        adults: input.adults,
        children: input.children,
        pets: input.pets,
        requests: input.requests,
        status: "contacted",
        quotedTotalPaise: record.totalPaise,
        quotedAdvancePaise: record.advancePaise,
        quoteSentAt: record.quoteSentAt,
      })
      .returning({ id: enquiries.id });

    const [request] = await tx
      .insert(paymentRequests)
      .values({
        enquiryId: enquiry!.id,
        tokenHash: record.tokenHash,
        reference: record.reference,
        totalPaise: record.totalPaise,
        advancePaise: record.advancePaise,
        advancePercent: record.advancePercent,
        holdExpiresAt: record.holdExpiresAt,
      })
      .returning({ id: paymentRequests.id });

    await tx.insert(paymentEvents).values({
      paymentRequestId: request!.id,
      kind: "held",
      detail: `${input.checkIn} → ${input.checkOut}, advance ₹${record.advancePaise / 100}`,
    });

    return { enquiryId: enquiry!.id, paymentRequestId: request!.id };
  },
};

/** For the public availability checks outside the lock (quote, enquiry form). */
export async function readTakenRanges(now = new Date()): Promise<DateRange[]> {
  // Holds via readLiveHolds, which never throws: a price check must keep
  // working before the Book & Pay migration has run.
  const [events, confirmed, holds] = await Promise.all([
    db
      .select({ startDate: calendarEvents.startDate, endDate: calendarEvents.endDate })
      .from(calendarEvents)
      .where(eq(calendarEvents.status, "confirmed")),
    db
      .select({ startDate: bookings.checkIn, endDate: bookings.checkOut })
      .from(bookings)
      .where(eq(bookings.status, "confirmed")),
    readLiveHolds(now),
  ]);
  return [...events, ...confirmed, ...holds];
}

/* ------------------------------ lookups -------------------------------- */

export type RequestWithEnquiry = { request: PaymentRequest; enquiry: Enquiry };

export async function findByToken(token: string): Promise<RequestWithEnquiry | null> {
  const [row] = await db
    .select({ request: paymentRequests, enquiry: enquiries })
    .from(paymentRequests)
    .innerJoin(enquiries, eq(enquiries.id, paymentRequests.enquiryId))
    .where(eq(paymentRequests.tokenHash, hashPayToken(token)))
    .limit(1);
  return row ?? null;
}

export async function findById(id: string): Promise<RequestWithEnquiry | null> {
  const [row] = await db
    .select({ request: paymentRequests, enquiry: enquiries })
    .from(paymentRequests)
    .innerJoin(enquiries, eq(enquiries.id, paymentRequests.enquiryId))
    .where(eq(paymentRequests.id, id))
    .limit(1);
  return row ?? null;
}

export async function findByEnquiryId(enquiryId: string): Promise<PaymentRequest | null> {
  try {
    const [row] = await db
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.enquiryId, enquiryId))
      .limit(1);
    return row ?? null;
  } catch (error) {
    if (isNotMigrated(error)) return null;
    throw error;
  }
}

/** Hold deadlines by enquiry, so the owner's enquiry list shows the real one. */
export async function holdDeadlinesByEnquiry(): Promise<Map<string, Date>> {
  try {
    const rows = await db
      .select({ enquiryId: paymentRequests.enquiryId, holdExpiresAt: paymentRequests.holdExpiresAt })
      .from(paymentRequests);
    return new Map(rows.map((row) => [row.enquiryId, row.holdExpiresAt]));
  } catch (error) {
    if (isNotMigrated(error)) return new Map();
    throw error;
  }
}

/* ------------------------------ mutations ------------------------------ */

export async function logPaymentEvent(
  paymentRequestId: string,
  kind: string,
  detail: string | null = null,
): Promise<void> {
  try {
    await db.insert(paymentEvents).values({ paymentRequestId, kind, detail });
  } catch (error) {
    // The audit trail must never undo the action it records.
    logger.error({ err: error, paymentRequestId, kind }, "Could not record payment event");
  }
}

export type SubmitUtrResult =
  | { ok: true; request: PaymentRequest }
  | { ok: false; reason: "duplicate_utr" | "not_awaiting" | "expired" };

/**
 * Records the guest's UTR (and optional screenshot) and stretches the hold to
 * 12 hours, so it cannot lapse while the owner opens the bank app.
 *
 * Conditional on the row still being awaiting payment AND inside its hold, in
 * the UPDATE itself, so a request the expiry job just closed cannot be
 * re-opened by a late submission.
 */
export async function submitUtr(
  id: string,
  utr: string,
  screenshot: { bytes: Buffer; mime: string } | null,
  now = new Date(),
): Promise<SubmitUtrResult> {
  const current = await findById(id);
  if (!current) return { ok: false, reason: "not_awaiting" };
  if (current.request.status !== "awaiting_payment") return { ok: false, reason: "not_awaiting" };
  if (now.getTime() >= current.request.holdExpiresAt.getTime()) return { ok: false, reason: "expired" };

  try {
    const [updated] = await db
      .update(paymentRequests)
      .set({
        status: "submitted",
        utr,
        utrSubmittedAt: now,
        holdExpiresAt: extendedHold(current.request.holdExpiresAt, now),
        ...(screenshot
          ? {
              screenshot: screenshot.bytes,
              screenshotMime: screenshot.mime,
              screenshotBytes: screenshot.bytes.length,
            }
          : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(paymentRequests.id, id),
          eq(paymentRequests.status, "awaiting_payment"),
          gte(paymentRequests.holdExpiresAt, now),
        ),
      )
      .returning();

    if (!updated) return { ok: false, reason: "not_awaiting" };
    return { ok: true, request: updated };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "duplicate_utr" };
    throw error;
  }
}

export async function setDecision(
  id: string,
  status: "confirmed" | "rejected",
  rejectReason: string | null = null,
  now = new Date(),
): Promise<PaymentRequest | null> {
  const [updated] = await db
    .update(paymentRequests)
    .set({ status, decidedAt: now, rejectReason, updatedAt: now })
    .where(
      and(
        eq(paymentRequests.id, id),
        inArray(paymentRequests.status, ["awaiting_payment", "submitted"]),
      ),
    )
    .returning();
  return updated ?? null;
}

/** Closes every unpaid hold whose deadline has passed. Returns what it closed. */
export async function expireDueHolds(now = new Date()): Promise<RequestWithEnquiry[]> {
  const closed = await db
    .update(paymentRequests)
    .set({ status: "expired", decidedAt: now, updatedAt: now })
    .where(
      and(
        eq(paymentRequests.status, "awaiting_payment"),
        sql`${paymentRequests.holdExpiresAt} <= ${now}`,
      ),
    )
    .returning({ id: paymentRequests.id });

  const out: RequestWithEnquiry[] = [];
  for (const row of closed) {
    const found = await findById(row.id);
    if (found) out.push(found);
  }
  return out;
}

/** Expired holds whose guest has not been told yet (e.g. after a failed send). */
export async function expiredNotNotified(): Promise<RequestWithEnquiry[]> {
  return db
    .select({ request: paymentRequests, enquiry: enquiries })
    .from(paymentRequests)
    .innerJoin(enquiries, eq(enquiries.id, paymentRequests.enquiryId))
    .where(
      and(
        eq(paymentRequests.status, "expired"),
        sql`${paymentRequests.expiryNotifiedAt} is null`,
        sql`${paymentRequests.decidedAt} > now() - interval '2 days'`,
      ),
    );
}

export async function markExpiryNotified(id: string, now = new Date()): Promise<void> {
  await db
    .update(paymentRequests)
    .set({ expiryNotifiedAt: now, updatedAt: now })
    .where(eq(paymentRequests.id, id));
}

/* -------------------------------- admin -------------------------------- */

export type AdminPaymentRow = {
  id: string;
  enquiryId: string;
  bookingId: string | null;
  reference: string;
  status: PaymentRequest["status"];
  guestName: string;
  guestPhone: string;
  guestEmail: string | null;
  checkIn: string | null;
  checkOut: string | null;
  guests: number;
  pets: number;
  totalPaise: number;
  advancePaise: number;
  utr: string | null;
  utrSubmittedAt: Date | null;
  hasScreenshot: boolean;
  holdExpiresAt: Date;
  decidedAt: Date | null;
  rejectReason: string | null;
  expiryNotifiedAt: Date | null;
  createdAt: Date;
};

/** Open requests first, then the last fortnight of decided ones. Never the image bytes. */
export async function listForAdmin(now = new Date()): Promise<AdminPaymentRow[]> {
  const since = new Date(now.getTime() - 14 * 86_400_000);
  const rows = await db
    .select({
      id: paymentRequests.id,
      enquiryId: paymentRequests.enquiryId,
      bookingId: enquiries.convertedBookingId,
      reference: paymentRequests.reference,
      status: paymentRequests.status,
      guestName: enquiries.name,
      guestPhone: enquiries.phone,
      guestEmail: enquiries.email,
      checkIn: enquiries.checkIn,
      checkOut: enquiries.checkOut,
      adults: enquiries.adults,
      children: enquiries.children,
      pets: enquiries.pets,
      totalPaise: paymentRequests.totalPaise,
      advancePaise: paymentRequests.advancePaise,
      utr: paymentRequests.utr,
      utrSubmittedAt: paymentRequests.utrSubmittedAt,
      screenshotBytes: paymentRequests.screenshotBytes,
      holdExpiresAt: paymentRequests.holdExpiresAt,
      decidedAt: paymentRequests.decidedAt,
      rejectReason: paymentRequests.rejectReason,
      expiryNotifiedAt: paymentRequests.expiryNotifiedAt,
      createdAt: paymentRequests.createdAt,
    })
    .from(paymentRequests)
    .innerJoin(enquiries, eq(enquiries.id, paymentRequests.enquiryId))
    .where(
      sql`${paymentRequests.status} in ('awaiting_payment','submitted') or ${paymentRequests.updatedAt} >= ${since}`,
    )
    .orderBy(desc(paymentRequests.createdAt))
    .limit(200);

  return rows.map(({ adults, children, pets, screenshotBytes, ...row }) => ({
    ...row,
    guests: (adults ?? 0) + (children ?? 0),
    pets: pets ?? 0,
    hasScreenshot: (screenshotBytes ?? 0) > 0,
  }));
}

export async function getScreenshot(
  id: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const [row] = await db
    .select({ bytes: paymentRequests.screenshot, mime: paymentRequests.screenshotMime })
    .from(paymentRequests)
    .where(eq(paymentRequests.id, id))
    .limit(1);
  return row?.bytes && row.mime ? { bytes: row.bytes, mime: row.mime } : null;
}

/** Payment events since a moment, for the owner's activity panel. */
export async function paymentEventsSince(after: Date, limit: number) {
  try {
    return await db
      .select({
        id: paymentEvents.id,
        kind: paymentEvents.kind,
        detail: paymentEvents.detail,
        at: paymentEvents.at,
        paymentRequestId: paymentEvents.paymentRequestId,
        guestName: enquiries.name,
        checkIn: enquiries.checkIn,
        checkOut: enquiries.checkOut,
      })
      .from(paymentEvents)
      .innerJoin(paymentRequests, eq(paymentRequests.id, paymentEvents.paymentRequestId))
      .innerJoin(enquiries, eq(enquiries.id, paymentRequests.enquiryId))
      .where(gte(paymentEvents.at, after))
      .orderBy(desc(paymentEvents.at))
      .limit(limit);
  } catch (error) {
    if (isNotMigrated(error)) return [];
    throw error;
  }
}
