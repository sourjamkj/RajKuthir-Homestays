import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import {
  appSettings,
  bookings,
  db,
  googleReviews,
  pool,
  type GoogleReview,
} from "@workspace/db";

import { logger } from "./logger";
import { ownerEmail, sendEmail } from "./book-pay-notify";
import { draftReply, isDrafterConfigured } from "./review-drafter";
import {
  addDays,
  approvalProblem,
  matchReviewToBooking,
  nextSpelling,
  onlyNewReviews,
  ownerReviewAlert,
  placeSpellingUsed,
  type PlaceSpelling,
} from "./review-rules";
import { getReviewSource, type FetchedReview } from "./review-source";
import { ensureReviewTables } from "./reviews-migrate";
import { SITE_ORIGIN } from "./seo";
import { isWhatsappEnabled, sendText, toWhatsappNumber } from "./whatsapp-client";

/**
 * Google reviews in, reply drafts out, and the owner's approve / post / skip.
 * Nothing reaches Google without the owner pressing Approve.
 */

const SPELLING_KEY = "reviews.last_place_spelling";
const ADMIN_URL = `${SITE_ORIGIN}/admin/reviews`;

/** Older reviews pulled in on the first poll are filed quietly, not alerted. */
const ALERT_IF_NEWER_THAN_MS = 3 * 86_400_000;
/** Model calls per poll, so a first import of old reviews cannot run up a bill. */
const MAX_DRAFTS_PER_RUN = 10;

/* ----------------------------- drafting ------------------------------ */

async function recentReplies(excludeId?: string): Promise<string[]> {
  const rows = await db
    .select({ id: googleReviews.id, text: googleReviews.replyText })
    .from(googleReviews)
    .where(isNotNull(googleReviews.replyText))
    .orderBy(desc(googleReviews.updatedAt))
    .limit(21);
  return rows.filter((row) => row.id !== excludeId && row.text).slice(0, 20).map((row) => row.text!);
}

async function lastSpelling(): Promise<string | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SPELLING_KEY));
  return row?.value ?? null;
}

async function saveSpelling(spelling: PlaceSpelling): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: SPELLING_KEY, value: spelling, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: spelling, updatedAt: new Date() } });
}

async function matchFor(review: Pick<GoogleReview, "reviewerName" | "createdAt">) {
  const reviewDate = review.createdAt.toISOString().slice(0, 10);
  const candidates = await db
    .select({ id: bookings.id, guestName: bookings.guestName, checkOut: bookings.checkOut, pets: bookings.pets })
    .from(bookings)
    .where(
      and(
        eq(bookings.status, "confirmed"),
        gte(bookings.checkOut, addDays(reviewDate, -21)),
        lte(bookings.checkOut, reviewDate),
      ),
    );
  return matchReviewToBooking({ reviewerName: review.reviewerName, reviewDate }, candidates);
}

/** (Re)drafts one review's reply and stores it as a draft. */
export async function draftFor(id: string): Promise<GoogleReview | null> {
  const [review] = await db.select().from(googleReviews).where(eq(googleReviews.id, id)).limit(1);
  if (!review || review.replyStatus === "posted") return review ?? null;

  const match = await matchFor(review);
  const spelling = nextSpelling(await lastSpelling());
  const result = await draftReply({
    reviewerName: review.reviewerName,
    rating: review.rating,
    reviewText: review.text,
    stayedWithPet: (match?.pets ?? 0) > 0,
    recentReplies: await recentReplies(review.id),
    spelling,
  });

  const used = placeSpellingUsed(result.text);
  if (used) await saveSpelling(used);

  const now = new Date();
  const [updated] = await db
    .update(googleReviews)
    .set({
      replyText: result.text,
      replyStatus: "draft",
      replyNote: result.note,
      matchedBookingId: match?.id ?? null,
      draftedAt: now,
      updatedAt: now,
    })
    .where(eq(googleReviews.id, id))
    .returning();
  return updated ?? null;
}

/* ------------------------------ alerts ------------------------------- */

/**
 * WhatsApp to the owner when the Cloud API can deliver free text — the owner
 * messaged the business number in the last 24 hours — otherwise email.
 */
async function alertOwner(review: GoogleReview): Promise<void> {
  const alert = ownerReviewAlert({
    reviewerName: review.reviewerName,
    rating: review.rating,
    reviewText: review.text,
    adminUrl: ADMIN_URL,
  });

  let sent = false;
  const owner = toWhatsappNumber(process.env["OWNER_WHATSAPP_NUMBER"] ?? "+91 62903 99165");
  if (owner && isWhatsappEnabled()) {
    try {
      const { rows } = await pool.query<{ last_inbound_at: Date | null }>(
        "SELECT last_inbound_at FROM wa_conversations WHERE phone = $1",
        [owner],
      );
      const last = rows[0]?.last_inbound_at;
      if (last && Date.now() - last.getTime() < 24 * 3_600_000) {
        sent = (await sendText({ to: owner, text: alert.text })).ok;
      }
    } catch (error) {
      logger.warn({ err: error instanceof Error ? error.message : error }, "Owner WhatsApp window check failed");
    }
  }
  if (!sent) sent = await sendEmail(await ownerEmail(), alert.subject, alert.text);

  if (sent) {
    await db.update(googleReviews).set({ ownerAlertedAt: new Date() }).where(eq(googleReviews.id, review.id));
  }
}

/* ------------------------------ intake ------------------------------- */

async function insertReviews(
  reviews: FetchedReview[],
  source: "gbp" | "manual",
  now: Date,
): Promise<GoogleReview[]> {
  if (!reviews.length) return [];
  const known = await db
    .select({ reviewId: googleReviews.reviewId })
    .from(googleReviews)
    .where(inArray(googleReviews.reviewId, reviews.map((review) => review.reviewId)));
  const fresh = onlyNewReviews(reviews, known.map((row) => row.reviewId));
  if (!fresh.length) return [];

  return db
    .insert(googleReviews)
    .values(
      fresh.map((review) => ({
        reviewId: review.reviewId,
        source,
        reviewerName: review.reviewerName,
        rating: review.rating,
        text: review.text,
        createdAt: review.createdAt,
        // Already answered on Google: file it, don't draft over it.
        replyText: review.existingReply,
        replyStatus: review.existingReply ? "posted" : "none",
        postedAt: review.existingReply ? now : null,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing({ target: googleReviews.reviewId })
    .returning();
}

export type PollResult = { source: "gbp" | "manual"; fetched: number; added: number; drafted: number; error?: string };

/** Every six hours: new reviews in, owner alerted, replies drafted. */
export async function pollReviews(now = new Date()): Promise<PollResult> {
  const source = getReviewSource();
  const result: PollResult = { source: source.kind, fetched: 0, added: 0, drafted: 0 };
  if (!(await ensureReviewTables())) return { ...result, error: "Review tables are not ready." };

  try {
    const fetched = await source.fetchNewReviews();
    result.fetched = fetched.length;
    const added = await insertReviews(fetched, source.kind, now);
    result.added = added.length;

    for (const review of added) {
      if (review.replyStatus === "posted") continue;
      if (now.getTime() - review.createdAt.getTime() < ALERT_IF_NEWER_THAN_MS) await alertOwner(review);
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    logger.error({ err: result.error }, "Fetching Google reviews failed");
  }

  // Draft anything still without a reply — including manual ones whose
  // first draft failed — a few at a time.
  const waiting = await db
    .select({ id: googleReviews.id })
    .from(googleReviews)
    .where(eq(googleReviews.replyStatus, "none"))
    .orderBy(desc(googleReviews.createdAt))
    .limit(MAX_DRAFTS_PER_RUN);
  for (const { id } of waiting) {
    try {
      await draftFor(id);
      result.drafted += 1;
    } catch (error) {
      logger.error({ err: error, reviewId: id }, "Drafting a review reply failed");
    }
  }
  return result;
}

/** A review the owner pasted in. The same review pasted twice is one review. */
export async function addManualReview(input: {
  reviewerName: string;
  rating: number;
  text: string | null;
  date: string;
}): Promise<{ review: GoogleReview; duplicate: boolean }> {
  await ensureReviewTables();
  const reviewId = `manual-${createHash("sha256")
    .update(`${input.reviewerName.trim().toLowerCase()}|${input.date}|${(input.text ?? "").trim()}`)
    .digest("hex")
    .slice(0, 24)}`;

  const [inserted] = await insertReviews(
    [
      {
        reviewId,
        reviewerName: input.reviewerName.trim(),
        rating: input.rating,
        text: input.text?.trim() || null,
        createdAt: new Date(`${input.date}T12:00:00+05:30`),
        existingReply: null,
      },
    ],
    "manual",
    new Date(),
  );

  if (!inserted) {
    const [existing] = await db.select().from(googleReviews).where(eq(googleReviews.reviewId, reviewId)).limit(1);
    return { review: existing!, duplicate: true };
  }
  const drafted = await draftFor(inserted.id).catch(() => null);
  return { review: drafted ?? inserted, duplicate: false };
}

/* --------------------------- owner actions --------------------------- */

export async function saveReplyDraft(id: string, text: string): Promise<GoogleReview | null> {
  const [updated] = await db
    .update(googleReviews)
    .set({ replyText: text.trim(), replyStatus: "draft", updatedAt: new Date() })
    .where(and(eq(googleReviews.id, id), inArray(googleReviews.replyStatus, ["none", "draft", "approved", "skipped"])))
    .returning();
  return updated ?? null;
}

export type ApproveOutcome =
  | { ok: true; review: GoogleReview; posted: boolean; listingUrl?: string }
  | { ok: false; status: number; error: string };

/**
 * Approve & post. Through the API the reply goes to Google now; without it
 * the reply is marked approved and the owner pastes it, then Mark posted.
 */
export async function approveReply(id: string, text: string): Promise<ApproveOutcome> {
  const problem = approvalProblem(text);
  if (problem) return { ok: false, status: 400, error: problem };

  const [review] = await db.select().from(googleReviews).where(eq(googleReviews.id, id)).limit(1);
  if (!review) return { ok: false, status: 404, error: "That review no longer exists." };
  if (review.replyStatus === "posted") return { ok: false, status: 409, error: "This reply is already posted." };

  const now = new Date();
  const source = getReviewSource();
  const viaApi = source.kind === "gbp" && review.source === "gbp";

  if (viaApi) {
    const posted = await source.postReply(review.reviewId, text.trim());
    const [updated] = await db
      .update(googleReviews)
      .set(
        posted.ok
          ? { replyText: text.trim(), replyStatus: "posted", replyNote: null, approvedAt: now, postedAt: now, updatedAt: now }
          : { replyText: text.trim(), replyStatus: "approved", replyNote: `Google refused the reply: ${posted.error}`, approvedAt: now, updatedAt: now },
      )
      .where(eq(googleReviews.id, id))
      .returning();
    if (!posted.ok) return { ok: false, status: 502, error: `Saved as approved, but Google refused it: ${posted.error}` };
    return { ok: true, review: updated!, posted: true };
  }

  const [updated] = await db
    .update(googleReviews)
    .set({ replyText: text.trim(), replyStatus: "approved", replyNote: null, approvedAt: now, updatedAt: now })
    .where(eq(googleReviews.id, id))
    .returning();
  return { ok: true, review: updated!, posted: false };
}

export async function markReplyPosted(id: string): Promise<GoogleReview | null> {
  const now = new Date();
  const [updated] = await db
    .update(googleReviews)
    .set({ replyStatus: "posted", postedAt: now, updatedAt: now })
    .where(and(eq(googleReviews.id, id), eq(googleReviews.replyStatus, "approved")))
    .returning();
  return updated ?? null;
}

export async function skipReview(id: string): Promise<GoogleReview | null> {
  const [updated] = await db
    .update(googleReviews)
    .set({ replyStatus: "skipped", updatedAt: new Date() })
    .where(and(eq(googleReviews.id, id), inArray(googleReviews.replyStatus, ["none", "draft", "approved"])))
    .returning();
  return updated ?? null;
}

export type ReviewView = GoogleReview & {
  matchedBooking: { id: string; guestName: string | null; checkIn: string; checkOut: string; pets: number | null; source: string } | null;
};

export async function listReviews(limit = 100): Promise<ReviewView[]> {
  if (!(await ensureReviewTables())) return [];
  const rows = await db
    .select({ review: googleReviews, booking: bookings })
    .from(googleReviews)
    .leftJoin(bookings, eq(bookings.id, googleReviews.matchedBookingId))
    .orderBy(desc(googleReviews.createdAt))
    .limit(limit);
  return rows.map(({ review, booking }) => ({
    ...review,
    matchedBooking: booking
      ? { id: booking.id, guestName: booking.guestName, checkIn: booking.checkIn, checkOut: booking.checkOut, pets: booking.pets, source: booking.source }
      : null,
  }));
}

export function reviewSettings() {
  const source = getReviewSource();
  return { source: source.kind, drafter: isDrafterConfigured() };
}
