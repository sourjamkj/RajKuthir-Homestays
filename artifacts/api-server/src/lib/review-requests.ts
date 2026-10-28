import { and, desc, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import {
  bookingIssues,
  bookings,
  db,
  whatsappMessages,
  type Booking,
  type WhatsappMessage,
} from "@workspace/db";

import { logger } from "./logger";
import { hasOptedOutOfMarketing } from "./notifications-repo";
import {
  LEGACY_REVIEW_TEMPLATE,
  addDays,
  decideReviewRequest,
  istDateOf,
  isOtaSource,
  nightsBetween,
  pickReviewVariant,
  reviewCutoff,
  stillSendable,
  variantFromTemplateName,
  type ReviewVariant,
} from "./review-rules";
import { ensureReviewTables } from "./reviews-migrate";
import { reviewTemplate } from "./whatsapp-templates";
import { toWhatsappNumber } from "./whatsapp-client";

/**
 * Queues the Google review ask for stays that have just ended.
 *
 * Separate from the 15-minute notifications scheduler on purpose: that one
 * only runs when the WhatsApp Cloud API is configured, and review asks are
 * useful before it is — the owner can send a queued draft from their own
 * WhatsApp with one tap. Every ask is a DRAFT: review requests are marketing,
 * and marketing always waits for the owner (notifications.ts says the same).
 */

/**
 * Which templates the Cloud API sends. "legacy" (default) keeps the one
 * already approved, rk_review_request; set WHATSAPP_REVIEW_TEMPLATES=v2 once
 * Meta approves rk_review_general / _pet / _short. The queue always records
 * the variant; only the name handed to Meta changes.
 */
export function reviewTemplateForSend(storedName: string): string {
  const v2 = process.env["WHATSAPP_REVIEW_TEMPLATES"]?.trim().toLowerCase() === "v2";
  if (v2) return storedName;
  return variantFromTemplateName(storedName) ? LEGACY_REVIEW_TEMPLATE : storedName;
}

export function reviewTemplatesLive(): boolean {
  return process.env["WHATSAPP_REVIEW_TEMPLATES"]?.trim().toLowerCase() === "v2";
}

async function openIssueIds(bookingIds: string[]): Promise<Set<string>> {
  if (!bookingIds.length) return new Set();
  const rows = await db
    .select({ bookingId: bookingIssues.bookingId })
    .from(bookingIssues)
    .where(and(inArray(bookingIssues.bookingId, bookingIds), isNull(bookingIssues.resolvedAt)));
  return new Set(rows.map((row) => row.bookingId));
}

async function lastSentTo(phone: string): Promise<Date | null> {
  const [row] = await db
    .select({ sentAt: whatsappMessages.sentAt })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.kind, "review_request"),
        eq(whatsappMessages.toPhone, phone),
        eq(whatsappMessages.status, "sent"),
      ),
    )
    .orderBy(desc(whatsappMessages.sentAt))
    .limit(1);
  return row?.sentAt ?? null;
}

async function openRequestFor(phone: string, exceptBookingId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: whatsappMessages.id })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.kind, "review_request"),
        eq(whatsappMessages.toPhone, phone),
        inArray(whatsappMessages.status, ["draft", "pending"]),
        ne(whatsappMessages.bookingId, exceptBookingId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export type ScheduleOutcome = {
  queued: number;
  skipped: Array<{ bookingId: string; guestName: string | null; reason: string }>;
};

/** Queues a review ask for one booking, or records/logs why not. */
async function considerBooking(booking: Booking, issues: Set<string>, now: Date, outcome: ScheduleOutcome): Promise<void> {
  const to = toWhatsappNumber(booking.guestPhone);
  const decision = decideReviewRequest({
    status: booking.status,
    checkOut: booking.checkOut,
    source: booking.source,
    whatsappNumber: to,
    issueOpen: issues.has(booking.id),
    optedOut: to ? await hasOptedOutOfMarketing(booking.guestPhone) : false,
    lastSentToNumberAt: to ? await lastSentTo(to) : null,
    openRequestForNumber: to ? await openRequestFor(to, booking.id) : false,
    now,
  });

  const spec = reviewTemplate(pickReviewVariant({ pets: booking.pets, nights: nightsBetween(booking.checkIn, booking.checkOut) }).variant, booking);

  if (!decision.ok) {
    outcome.skipped.push({ bookingId: booking.id, guestName: booking.guestName, reason: decision.reason });
    logger.info({ bookingId: booking.id, reason: decision.reason }, "Review request skipped");
    if (decision.persist && to) {
      // Recorded as a cancelled row so the owner sees why, and so the unique
      // (booking, kind) index stops this booking being reconsidered.
      await db
        .insert(whatsappMessages)
        .values({
          bookingId: booking.id,
          kind: "review_request",
          status: "cancelled",
          toPhone: to,
          templateName: spec.name,
          templateParams: spec.params,
          preview: spec.preview,
          sendAfter: now,
          error: `Skipped: ${decision.reason}`,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: [whatsappMessages.bookingId, whatsappMessages.kind] });
    }
    return;
  }

  const inserted = await db
    .insert(whatsappMessages)
    .values({
      bookingId: booking.id,
      kind: "review_request",
      // Always a draft: marketing, and OTA guests above all, wait for the owner.
      status: "draft",
      toPhone: to!,
      templateName: spec.name,
      templateParams: spec.params,
      preview: spec.preview,
      sendAfter: decision.sendAfter,
      error: decision.note,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: [whatsappMessages.bookingId, whatsappMessages.kind] })
    .returning({ id: whatsappMessages.id });

  if (inserted.length) outcome.queued += 1;
}

/**
 * Stays that ended in the last three days and have no review ask yet.
 * Idempotent: the (booking, kind) unique index drops anything already queued.
 */
export async function scheduleReviewRequests(now = new Date()): Promise<ScheduleOutcome> {
  const outcome: ScheduleOutcome = { queued: 0, skipped: [] };
  if (!(await ensureReviewTables())) return outcome;

  const today = istDateOf(now);
  const ended = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.status, "confirmed"),
        gte(bookings.checkOut, addDays(today, -3)),
        lte(bookings.checkOut, today),
      ),
    );
  if (!ended.length) return outcome;

  const already = await db
    .select({ bookingId: whatsappMessages.bookingId })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.kind, "review_request"),
        inArray(
          whatsappMessages.bookingId,
          ended.map((booking) => booking.id),
        ),
      ),
    );
  const done = new Set(already.map((row) => row.bookingId));
  const issues = await openIssueIds(ended.map((booking) => booking.id));

  for (const booking of ended) {
    if (done.has(booking.id)) continue;
    try {
      await considerBooking(booking, issues, now, outcome);
    } catch (error) {
      logger.error({ err: error, bookingId: booking.id }, "Could not schedule a review request");
    }
  }
  return outcome;
}

/**
 * Called by the outbox just before a released review ask goes out: the
 * owner may approve a draft days later, or cancel the stay, or flag an issue.
 */
export async function reviewStillSendable(
  message: Pick<WhatsappMessage, "bookingId">,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!message.bookingId) return { ok: false, reason: "Not tied to a booking" };
  const [booking] = await db
    .select({ status: bookings.status, checkOut: bookings.checkOut })
    .from(bookings)
    .where(eq(bookings.id, message.bookingId))
    .limit(1);
  const issues = await openIssueIds([message.bookingId]);
  return stillSendable({
    bookingStatus: booking?.status ?? null,
    checkOut: booking?.checkOut ?? null,
    issueOpen: issues.has(message.bookingId),
    now,
  });
}

/* -------------------------------- admin -------------------------------- */

function waLink(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export type ReviewRequestRow = {
  id: string;
  bookingId: string | null;
  status: WhatsappMessage["status"];
  guestName: string | null;
  source: string | null;
  checkIn: string | null;
  checkOut: string | null;
  pets: number;
  nights: number;
  variant: ReviewVariant | null;
  autoVariant: ReviewVariant | null;
  /** Why this variant: the automatic reason, or "Switched by you". */
  variantReason: string;
  ota: boolean;
  note: string | null;
  preview: string;
  sendAfter: Date;
  cutoff: Date | null;
  sentAt: Date | null;
  /** Send from the owner's own WhatsApp — works before the Cloud API is live. */
  manualWhatsappUrl: string;
};

/** Review asks from the last 30 days, newest stay first. */
export async function listReviewRequests(now = new Date()): Promise<ReviewRequestRow[]> {
  if (!(await ensureReviewTables())) return [];
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const rows = await db
    .select({ message: whatsappMessages, booking: bookings })
    .from(whatsappMessages)
    .leftJoin(bookings, eq(bookings.id, whatsappMessages.bookingId))
    .where(and(eq(whatsappMessages.kind, "review_request"), gte(whatsappMessages.createdAt, since)))
    .orderBy(desc(whatsappMessages.sendAfter))
    .limit(100);

  return rows.map(({ message, booking }) => {
    const nights = booking ? nightsBetween(booking.checkIn, booking.checkOut) : 0;
    const auto = booking ? pickReviewVariant({ pets: booking.pets, nights }) : null;
    const variant = variantFromTemplateName(message.templateName);
    const switched = Boolean(auto && variant && auto.variant !== variant);
    return {
      id: message.id,
      bookingId: message.bookingId,
      status: message.status,
      guestName: booking?.guestName ?? null,
      source: booking?.source ?? null,
      checkIn: booking?.checkIn ?? null,
      checkOut: booking?.checkOut ?? null,
      pets: booking?.pets ?? 0,
      nights,
      variant,
      autoVariant: auto?.variant ?? null,
      variantReason: switched ? `Switched by you (automatic choice: ${auto!.variant} — ${auto!.reason})` : auto?.reason ?? "",
      ota: booking ? isOtaSource(booking.source) : false,
      note: message.error,
      preview: message.preview,
      sendAfter: message.sendAfter,
      cutoff: booking ? reviewCutoff(booking.checkOut) : null,
      sentAt: message.sentAt,
      manualWhatsappUrl: waLink(message.toPhone, message.preview),
    };
  });
}

/** Switches a not-yet-sent ask to another variant. */
export async function switchReviewVariant(id: string, variant: ReviewVariant): Promise<WhatsappMessage | null> {
  const [row] = await db
    .select({ message: whatsappMessages, booking: bookings })
    .from(whatsappMessages)
    .leftJoin(bookings, eq(bookings.id, whatsappMessages.bookingId))
    .where(and(eq(whatsappMessages.id, id), eq(whatsappMessages.kind, "review_request")))
    .limit(1);
  if (!row || !["draft", "pending"].includes(row.message.status)) return null;

  const spec = reviewTemplate(variant, { guestName: row.booking?.guestName ?? null });
  const [updated] = await db
    .update(whatsappMessages)
    .set({ templateName: spec.name, templateParams: spec.params, preview: spec.preview, updatedAt: new Date() })
    .where(and(eq(whatsappMessages.id, id), inArray(whatsappMessages.status, ["draft", "pending"])))
    .returning();
  return updated ?? null;
}

/**
 * Releases a draft to the outbox, unless it is already too late to send.
 * OTA asks are released only by this explicit owner action, never by a
 * global setting.
 */
export async function releaseReviewRequest(
  id: string,
  now = new Date(),
): Promise<{ ok: true; message: WhatsappMessage } | { ok: false; status: number; error: string }> {
  const [message] = await db.select().from(whatsappMessages).where(eq(whatsappMessages.id, id)).limit(1);
  if (!message || message.kind !== "review_request") return { ok: false, status: 404, error: "That review request no longer exists." };
  if (message.status !== "draft") return { ok: false, status: 409, error: `This request is already ${message.status}.` };

  const check = await reviewStillSendable(message, now);
  if (!check.ok) return { ok: false, status: 409, error: check.reason };

  const [updated] = await db
    .update(whatsappMessages)
    .set({ status: "pending", updatedAt: now })
    .where(and(eq(whatsappMessages.id, id), eq(whatsappMessages.status, "draft")))
    .returning();
  return updated ? { ok: true, message: updated } : { ok: false, status: 409, error: "This request changed meanwhile." };
}

/** The owner sent it from their own WhatsApp. Counts for the 180-day rule. */
export async function markReviewRequestSentManually(id: string, now = new Date()): Promise<WhatsappMessage | null> {
  const [updated] = await db
    .update(whatsappMessages)
    .set({ status: "sent", sentAt: now, providerMessageId: "manual", error: null, updatedAt: now })
    .where(
      and(
        eq(whatsappMessages.id, id),
        eq(whatsappMessages.kind, "review_request"),
        inArray(whatsappMessages.status, ["draft", "pending", "failed"]),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function cancelReviewRequest(id: string): Promise<WhatsappMessage | null> {
  const [updated] = await db
    .update(whatsappMessages)
    .set({ status: "cancelled", error: "Cancelled by you", updatedAt: new Date() })
    .where(
      and(
        eq(whatsappMessages.id, id),
        eq(whatsappMessages.kind, "review_request"),
        inArray(whatsappMessages.status, ["draft", "pending", "failed"]),
      ),
    )
    .returning();
  return updated ?? null;
}

/* ---------------------------- issues during stay ---------------------------- */

export type RecentStay = {
  bookingId: string;
  guestName: string | null;
  source: string;
  checkIn: string;
  checkOut: string;
  issue: { note: string | null; flaggedAt: Date; resolvedAt: Date | null } | null;
  hasReviewRequest: boolean;
};

/** Stays from a week ago to three days ahead: the ones an issue flag can still matter for. */
export async function recentStays(now = new Date()): Promise<RecentStay[]> {
  if (!(await ensureReviewTables())) return [];
  const today = istDateOf(now);
  const rows = await db
    .select({ booking: bookings, issue: bookingIssues })
    .from(bookings)
    .leftJoin(bookingIssues, eq(bookingIssues.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.status, "confirmed"),
        gte(bookings.checkOut, addDays(today, -7)),
        lte(bookings.checkIn, addDays(today, 3)),
      ),
    )
    .orderBy(desc(bookings.checkOut));

  const ids = rows.map((row) => row.booking.id);
  const asked = ids.length
    ? await db
        .select({ bookingId: whatsappMessages.bookingId })
        .from(whatsappMessages)
        .where(and(eq(whatsappMessages.kind, "review_request"), inArray(whatsappMessages.bookingId, ids)))
    : [];
  const askedIds = new Set(asked.map((row) => row.bookingId));

  return rows.map(({ booking, issue }) => ({
    bookingId: booking.id,
    guestName: booking.guestName,
    source: booking.source,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    issue: issue ? { note: issue.note, flaggedAt: issue.flaggedAt, resolvedAt: issue.resolvedAt } : null,
    hasReviewRequest: askedIds.has(booking.id),
  }));
}

export async function flagIssue(bookingId: string, note: string | null): Promise<void> {
  await db
    .insert(bookingIssues)
    .values({ bookingId, note, flaggedAt: new Date(), resolvedAt: null })
    .onConflictDoUpdate({ target: bookingIssues.bookingId, set: { note, flaggedAt: new Date(), resolvedAt: null } });

  // An ask still waiting for this stay must not go out now.
  await db
    .update(whatsappMessages)
    .set({ status: "cancelled", error: "Cancelled: issue during stay flagged", updatedAt: new Date() })
    .where(
      and(
        eq(whatsappMessages.bookingId, bookingId),
        eq(whatsappMessages.kind, "review_request"),
        inArray(whatsappMessages.status, ["draft", "pending"]),
      ),
    );
}

/** The owner called the guest. The task goes away; nothing is sent automatically. */
export async function resolveIssue(bookingId: string): Promise<boolean> {
  const updated = await db
    .update(bookingIssues)
    .set({ resolvedAt: new Date() })
    .where(eq(bookingIssues.bookingId, bookingId))
    .returning({ bookingId: bookingIssues.bookingId });
  return updated.length > 0;
}

export async function clearIssue(bookingId: string): Promise<void> {
  await db.delete(bookingIssues).where(eq(bookingIssues.bookingId, bookingId));
}

/**
 * After the call, the owner may still choose to ask for a review. Queued as
 * a draft like any other, under the same window and 180-day rules — and
 * replacing an earlier cancelled ask for the stay.
 */
export async function queueReviewRequestNow(bookingId: string, now = new Date()): Promise<{ ok: true } | { ok: false; error: string }> {
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) return { ok: false, error: "That booking no longer exists." };

  const issues = await openIssueIds([bookingId]);
  if (issues.has(bookingId)) return { ok: false, error: "Mark the issue as handled (called the guest) first." };

  await db
    .delete(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.bookingId, bookingId),
        eq(whatsappMessages.kind, "review_request"),
        eq(whatsappMessages.status, "cancelled"),
      ),
    );

  const outcome: ScheduleOutcome = { queued: 0, skipped: [] };
  await considerBooking(booking, issues, now, outcome);
  if (outcome.queued) return { ok: true };
  return { ok: false, error: outcome.skipped[0]?.reason ?? "A review request already exists for this stay." };
}
