import { Router, type IRouter, type Response } from "express";

import { requireAdmin } from "../lib/admin-auth";
import { logger } from "../lib/logger";
import {
  cancelReviewRequest,
  clearIssue,
  flagIssue,
  listReviewRequests,
  markReviewRequestSentManually,
  queueReviewRequestNow,
  recentStays,
  releaseReviewRequest,
  resolveIssue,
  reviewTemplatesLive,
  scheduleReviewRequests,
  switchReviewVariant,
} from "../lib/review-requests";
import { LEAVE_REVIEW_URL, LISTING_URL, type ReviewVariant } from "../lib/review-rules";
import {
  addManualReview,
  approveReply,
  draftFor,
  listReviews,
  markReplyPosted,
  pollReviews,
  reviewSettings,
  saveReplyDraft,
  skipReview,
} from "../lib/reviews-service";
import { isWhatsappEnabled } from "../lib/whatsapp-client";

/**
 * /admin "Reviews": the review-request queue (Part A) and replies to Google
 * reviews (Part B). Owner only. Nothing here posts to Google or messages a
 * guest without an explicit press of a button.
 */

const router: IRouter = Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VARIANTS: ReviewVariant[] = ["general", "pet", "short"];

function idParam(raw: unknown): string | null {
  return typeof raw === "string" && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
}

function notFound(res: Response, what = "That item no longer exists.") {
  res.status(404).json({ error: what });
}

router.get("/admin/reviews", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const [reviews, requests, stays] = await Promise.all([listReviews(), listReviewRequests(), recentStays()]);
  res.json({
    ...reviewSettings(),
    whatsappSending: isWhatsappEnabled(),
    newTemplatesLive: reviewTemplatesLive(),
    listingUrl: LISTING_URL,
    leaveReviewUrl: LEAVE_REVIEW_URL,
    reviews,
    requests,
    stays,
    // "Call guest about issue": open flags, newest first.
    tasks: stays
      .filter((stay) => stay.issue && !stay.issue.resolvedAt)
      .map((stay) => ({ bookingId: stay.bookingId, guestName: stay.guestName, checkOut: stay.checkOut, note: stay.issue!.note })),
  });
});

/* ------------------------- Part A: review requests ------------------------- */

router.post("/admin/review-requests/refresh", requireAdmin, async (_req, res) => {
  res.json(await scheduleReviewRequests());
});

router.post("/admin/review-requests/:id/variant", requireAdmin, async (req, res) => {
  const id = idParam(req.params.id);
  const variant = req.body?.variant as ReviewVariant;
  if (!id || !VARIANTS.includes(variant)) {
    res.status(400).json({ error: "Choose general, pet or short." });
    return;
  }
  const updated = await switchReviewVariant(id, variant);
  if (!updated) {
    res.status(409).json({ error: "Only a request that has not been sent can be switched." });
    return;
  }
  res.json({ ok: true });
});

router.post("/admin/review-requests/:id/approve", requireAdmin, async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return notFound(res);
  const result = await releaseReviewRequest(id);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ ok: true, sendsAutomatically: isWhatsappEnabled() });
});

router.post("/admin/review-requests/:id/sent-manually", requireAdmin, async (req, res) => {
  const id = idParam(req.params.id);
  const updated = id ? await markReviewRequestSentManually(id) : null;
  if (!updated) return notFound(res, "That request is not waiting to be sent.");
  res.json({ ok: true });
});

router.post("/admin/review-requests/:id/cancel", requireAdmin, async (req, res) => {
  const id = idParam(req.params.id);
  const updated = id ? await cancelReviewRequest(id) : null;
  if (!updated) return notFound(res, "That request is not waiting to be sent.");
  res.json({ ok: true });
});

router.post("/admin/bookings/:id/issue", requireAdmin, async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return notFound(res);
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) || null : null;
  await flagIssue(id, note);
  logger.info({ bookingId: id }, "Issue during stay flagged");
  res.json({ ok: true });
});

router.post("/admin/bookings/:id/issue/resolved", requireAdmin, async (req, res) => {
  const id = idParam(req.params.id);
  if (!id || !(await resolveIssue(id))) return notFound(res, "No issue is flagged on that stay.");
  res.json({ ok: true });
});

router.delete("/admin/bookings/:id/issue", requireAdmin, async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return notFound(res);
  await clearIssue(id);
  res.json({ ok: true });
});

router.post("/admin/bookings/:id/review-request", requireAdmin, async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return notFound(res);
  const result = await queueReviewRequestNow(id);
  if (!result.ok) {
    res.status(409).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

/* -------------------------- Part B: review replies -------------------------- */

router.post("/admin/reviews/poll", requireAdmin, async (_req, res) => {
  res.json(await pollReviews());
});

router.post("/admin/reviews", requireAdmin, async (req, res) => {
  const reviewerName = typeof req.body?.reviewerName === "string" ? req.body.reviewerName.trim().slice(0, 120) : "";
  const rating = Number(req.body?.rating);
  const text = typeof req.body?.text === "string" ? req.body.text.slice(0, 5000) : null;
  const date = typeof req.body?.date === "string" ? req.body.date : "";
  if (!reviewerName) {
    res.status(400).json({ error: "Add the reviewer's name as Google shows it." });
    return;
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    res.status(400).json({ error: "Rating must be 1 to 5 stars." });
    return;
  }
  if (!ISO_DATE.test(date)) {
    res.status(400).json({ error: "Add the review date." });
    return;
  }
  const result = await addManualReview({ reviewerName, rating, text, date });
  res.status(result.duplicate ? 200 : 201).json(result);
});

router.post("/admin/reviews/:id/draft", requireAdmin, async (req, res) => {
  const id = idParam(req.params.id);
  const updated = id ? await draftFor(id) : null;
  if (!updated) return notFound(res);
  res.json(updated);
});

router.put("/admin/reviews/:id/reply", requireAdmin, async (req, res) => {
  const id = idParam(req.params.id);
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  if (!id) return notFound(res);
  if (!text.trim()) {
    res.status(400).json({ error: "The reply is empty." });
    return;
  }
  const updated = await saveReplyDraft(id, text);
  if (!updated) {
    res.status(409).json({ error: "This reply is already posted." });
    return;
  }
  res.json(updated);
});

router.post("/admin/reviews/:id/approve", requireAdmin, async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return notFound(res);
  const result = await approveReply(id, typeof req.body?.text === "string" ? req.body.text : "");
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ review: result.review, posted: result.posted, listingUrl: LISTING_URL });
});

router.post("/admin/reviews/:id/posted", requireAdmin, async (req, res) => {
  const id = idParam(req.params.id);
  const updated = id ? await markReplyPosted(id) : null;
  if (!updated) return notFound(res, "Approve the reply first.");
  res.json(updated);
});

router.post("/admin/reviews/:id/skip", requireAdmin, async (req, res) => {
  const id = idParam(req.params.id);
  const updated = id ? await skipReview(id) : null;
  if (!updated) return notFound(res, "This review cannot be skipped now.");
  res.json(updated);
});

export default router;
