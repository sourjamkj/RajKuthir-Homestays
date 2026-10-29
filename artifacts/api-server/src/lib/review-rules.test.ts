import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FIX_PLACEHOLDER,
  SIGN_OFF,
  applySpelling,
  approvalProblem,
  checkDraft,
  decideReviewRequest,
  fallbackDraft,
  finishDraft,
  isComplaint,
  matchReviewToBooking,
  namesMatch,
  nextSpelling,
  onlyNewReviews,
  pickReviewVariant,
  reviewRequestText,
  reviewSendTime,
  starRating,
  stillSendable,
  variantFromTemplateName,
  REVIEW_TEMPLATE_NAMES,
} from "./review-rules.ts";

/** 2026-11-18 at hh:mm IST, as a UTC Date. */
const ist = (date: string, hh: number, mm = 0) =>
  new Date(Date.parse(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:30`));

/* ------------------------------ variants ------------------------------ */

test("variant: pets win over a one-night stay", () => {
  assert.equal(pickReviewVariant({ pets: 1, nights: 1 }).variant, "pet");
  assert.equal(pickReviewVariant({ pets: 2, nights: 3 }).variant, "pet");
});

test("variant: one night without pets is short; longer is general", () => {
  assert.equal(pickReviewVariant({ pets: 0, nights: 1 }).variant, "short");
  assert.equal(pickReviewVariant({ pets: null, nights: 1 }).variant, "short");
  assert.equal(pickReviewVariant({ pets: 0, nights: 2 }).variant, "general");
});

test("variant: reason is explained for the owner", () => {
  assert.match(pickReviewVariant({ pets: 2, nights: 2 }).reason, /2 pets/);
  assert.match(pickReviewVariant({ pets: 0, nights: 1 }).reason, /1-night/);
});

test("variant: template names round-trip", () => {
  for (const [variant, name] of Object.entries(REVIEW_TEMPLATE_NAMES)) {
    assert.equal(variantFromTemplateName(name), variant);
  }
  assert.equal(variantFromTemplateName("rk_review_request"), null);
});

test("request text: same words for everyone — never conditional on enjoying it", () => {
  for (const variant of ["general", "pet", "short"] as const) {
    const text = reviewRequestText(variant, "Riya");
    assert.match(text, /^(Hi|Namaskar) Riya,/);
    assert.match(text, /https:\/\/g\.page\/r\/CR9H9DboJM75EBM\/review/);
    assert.doesNotMatch(text, /\bif you (enjoyed|liked|loved|were happy)/i);
    assert.doesNotMatch(text, /treated you kindly/i);
    assert.match(text, /\n\nWarm Regards,\nSourja Mukherjee\nRaj Kuthir Homestays – Sobuj Potro$/);
    assert.match(text, /\nhttps:\/\/g\.page\/r\/CR9H9DboJM75EBM\/review\n/, "the link sits on its own line");
    assert.doesNotMatch(text, /\n{3,}/);
  }
});

/* ------------------------------- timing ------------------------------- */

test("timing: queued before check-out day goes at 14:00 IST on check-out day", () => {
  const at = reviewSendTime("2026-11-18", ist("2026-11-17", 20));
  assert.equal(at?.toISOString(), ist("2026-11-18", 14).toISOString());
});

test("timing: exactly 14:00 on check-out day still counts as on time", () => {
  assert.equal(reviewSendTime("2026-11-18", ist("2026-11-18", 14))?.toISOString(), ist("2026-11-18", 14).toISOString());
});

test("timing: scheduled after 14:00 on check-out day goes at 11:00 next day", () => {
  assert.equal(reviewSendTime("2026-11-18", ist("2026-11-18", 16))?.toISOString(), ist("2026-11-19", 11).toISOString());
});

test("timing: scheduled early on a later morning goes at 11:00 that same day", () => {
  assert.equal(reviewSendTime("2026-11-18", ist("2026-11-20", 7))?.toISOString(), ist("2026-11-20", 11).toISOString());
});

test("timing: 11:00 on day 3 after check-out is the last slot; later is skipped", () => {
  assert.equal(reviewSendTime("2026-11-18", ist("2026-11-21", 9))?.toISOString(), ist("2026-11-21", 11).toISOString());
  assert.equal(reviewSendTime("2026-11-18", ist("2026-11-21", 12)), null);
  assert.equal(reviewSendTime("2026-11-18", ist("2026-11-25", 9)), null);
});

/* ----------------------------- eligibility ---------------------------- */

const base = {
  status: "confirmed",
  checkOut: "2026-11-18",
  source: "direct",
  whatsappNumber: "919830040042",
  issueOpen: false,
  optedOut: false,
  lastSentToNumberAt: null,
  openRequestForNumber: false,
  now: ist("2026-11-18", 9),
};

test("eligibility: a direct stay that checked out today is queued for 14:00", () => {
  const decision = decideReviewRequest(base);
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.sendAfter.toISOString(), ist("2026-11-18", 14).toISOString());
    assert.equal(decision.note, null);
  }
});

test("eligibility: not confirmed, or not checked out yet, is skipped and retried later", () => {
  const cancelled = decideReviewRequest({ ...base, status: "cancelled" });
  assert.equal(cancelled.ok, false);
  const future = decideReviewRequest({ ...base, checkOut: "2026-11-19" });
  assert.equal(future.ok, false);
  if (!future.ok) assert.equal(future.persist, false);
});

test("eligibility: OTA bookings are only ever drafts, with a note", () => {
  for (const source of ["bookingCom", "airbnb", "makeMyTrip"]) {
    const decision = decideReviewRequest({ ...base, source });
    assert.equal(decision.ok, true);
    if (decision.ok) assert.match(decision.note ?? "", /OTA booking — draft only/);
  }
});

test("eligibility: a number asked within 180 days is suppressed; after 180 it is not", () => {
  const recent = decideReviewRequest({ ...base, lastSentToNumberAt: ist("2026-06-01", 11) });
  assert.equal(recent.ok, false);
  if (!recent.ok) {
    assert.match(recent.reason, /180 days/);
    assert.equal(recent.persist, true);
  }
  const old = decideReviewRequest({ ...base, lastSentToNumberAt: ist("2026-05-01", 11) });
  assert.equal(old.ok, true);
});

test("eligibility: an open issue blocks the ask and asks the owner to call", () => {
  const decision = decideReviewRequest({ ...base, issueOpen: true });
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.ownerTask, true);
    assert.equal(decision.persist, false);
  }
});

test("eligibility: no WhatsApp number is skipped, opt-out is recorded", () => {
  assert.equal(decideReviewRequest({ ...base, whatsappNumber: null }).ok, false);
  const optedOut = decideReviewRequest({ ...base, optedOut: true });
  assert.equal(optedOut.ok, false);
  if (!optedOut.ok) assert.equal(optedOut.persist, true);
});

test("eligibility: first scheduled more than 3 days late is skipped", () => {
  const decision = decideReviewRequest({ ...base, now: ist("2026-11-22", 9) });
  assert.equal(decision.ok, false);
});

test("still sendable: an approval after the window, or a cancelled booking, does not go out", () => {
  assert.equal(stillSendable({ bookingStatus: "confirmed", checkOut: "2026-11-18", issueOpen: false, now: ist("2026-11-20", 15) }).ok, true);
  assert.equal(stillSendable({ bookingStatus: "confirmed", checkOut: "2026-11-18", issueOpen: false, now: ist("2026-11-21", 11, 1) }).ok, false);
  assert.equal(stillSendable({ bookingStatus: "cancelled", checkOut: "2026-11-18", issueOpen: false, now: ist("2026-11-19", 11) }).ok, false);
  assert.equal(stillSendable({ bookingStatus: "confirmed", checkOut: "2026-11-18", issueOpen: true, now: ist("2026-11-19", 11) }).ok, false);
});

/* ------------------------------ matching ------------------------------ */

test("names: similar names match, different ones do not", () => {
  assert.equal(namesMatch("Prasun S.", "Prasun Singha Roy"), true);
  assert.equal(namesMatch("riya ghosh", "Riya"), true);
  assert.equal(namesMatch("Singha Roy", "Prasun Singha Roy"), true);
  assert.equal(namesMatch("Amit Das", "Rana Datta"), false);
  assert.equal(namesMatch("", "Rana Datta"), false);
});

test("matching: check-out within the 21 days before the review; closest wins", () => {
  const stays = [
    { id: "a", guestName: "Riya Ghosh", checkOut: "2026-10-01", pets: 0 },
    { id: "b", guestName: "Riya Ghosh", checkOut: "2026-11-10", pets: 1 },
    { id: "c", guestName: "Riya Ghosh", checkOut: "2026-11-20", pets: 0 },
  ];
  assert.equal(matchReviewToBooking({ reviewerName: "Riya G", reviewDate: "2026-11-15" }, stays)?.id, "b");
  // Exactly 21 days before is inside; 22 is not.
  assert.equal(matchReviewToBooking({ reviewerName: "Riya", reviewDate: "2026-10-22" }, stays)?.id, "a");
  assert.equal(matchReviewToBooking({ reviewerName: "Riya", reviewDate: "2026-10-23" }, stays), null);
  // A check-out after the review cannot be the stay reviewed.
  assert.equal(matchReviewToBooking({ reviewerName: "Riya", reviewDate: "2026-11-09" }, stays), null);
  assert.equal(matchReviewToBooking({ reviewerName: "Somebody Else", reviewDate: "2026-11-15" }, stays), null);
});

/* ------------------------------- drafts ------------------------------- */

const good = `Thank you, Riya, for the lovely words about the garden. We are so glad the villa felt like home and would love to welcome you back.\n\n${SIGN_OFF}`;

test("draft check: a good reply passes", () => {
  assert.deepEqual(checkDraft({ draft: good, reviewText: "Loved the garden, felt like home.", rating: 5, recentReplies: [] }), []);
});

test("draft check: Cafe Soi, Prantik, the kitchen and distances are refused unless the reviewer mentioned them", () => {
  const reply = (body: string) => `Thank you, Riya. ${body} We hope to see you again.\n\n${SIGN_OFF}`;
  const review = "Lovely stay, very peaceful.";
  assert.ok(checkDraft({ draft: reply("Do try Cafe Soi next time."), reviewText: review, rating: 5, recentReplies: [] }).some((p) => /Cafe Soi/.test(p)));
  assert.ok(checkDraft({ draft: reply("Prantik station is close by."), reviewText: review, rating: 5, recentReplies: [] }).some((p) => /Prantik/.test(p)));
  assert.ok(checkDraft({ draft: reply("The kitchen is yours to use."), reviewText: review, rating: 5, recentReplies: [] }).some((p) => /kitchen/.test(p)));
  assert.ok(checkDraft({ draft: reply("We are only 10 minutes from the university."), reviewText: review, rating: 5, recentReplies: [] }).some((p) => /distance/.test(p)));

  // Allowed when the reviewer brought it up.
  const cafeReview = "The coffee at Cafe Soi was great and the kitchen was handy.";
  assert.deepEqual(
    checkDraft({ draft: reply("We're glad you enjoyed the coffee at Cafe Soi and the kitchen."), reviewText: cafeReview, rating: 5, recentReplies: [] }),
    [],
  );
});

test("draft check: more than one place name, emojis, offers and repeats are refused", () => {
  const review = "Great stay.";
  const many = `Thank you, Riya. Santiniketan and Bolpur are lovely in winter. Hope to see you again.\n\n${SIGN_OFF}`;
  assert.ok(checkDraft({ draft: many, reviewText: review, rating: 5, recentReplies: [] }).some((p) => /place name/.test(p)));
  const emoji = `Thank you, Riya 😊. Hope to see you again.\n\n${SIGN_OFF}`;
  assert.ok(checkDraft({ draft: emoji, reviewText: review, rating: 5, recentReplies: [] }).some((p) => /emoji/.test(p)));
  const offer = `Thank you, Riya. Here is a 10% discount for next time. Hope to see you again.\n\n${SIGN_OFF}`;
  assert.ok(checkDraft({ draft: offer, reviewText: review, rating: 5, recentReplies: [] }).some((p) => /discount/.test(p)));
  assert.ok(checkDraft({ draft: good, reviewText: "Loved the garden.", rating: 5, recentReplies: [good] }).some((p) => /recent reply/.test(p)));
});

test("draft check: complaints need the [FIX] placeholder", () => {
  const apology = `Thank you for the honest feedback, Riya. I'm sorry the hot water was not working. ${FIX_PLACEHOLDER} Please reach me on +91 62903 99165.\n\n${SIGN_OFF}`;
  assert.deepEqual(checkDraft({ draft: apology, reviewText: "Hot water was not working.", rating: 2, recentReplies: [] }), []);
  const noFix = apology.replace(` ${FIX_PLACEHOLDER}`, "");
  assert.ok(checkDraft({ draft: noFix, reviewText: "Hot water was not working.", rating: 2, recentReplies: [] }).some((p) => /\[FIX/.test(p)));
});

test("complaints: low ratings and complaint words, but not 'no issues'", () => {
  assert.equal(isComplaint(3, "Nice place"), true);
  assert.equal(isComplaint(5, "Lovely, but the bathroom smelled damp."), true);
  assert.equal(isComplaint(5, "No issues at all, everything was perfect."), false);
  assert.equal(isComplaint(5, "We didn't have any problems."), false);
  assert.equal(isComplaint(5, "Peaceful and clean."), false);
});

test("approval: blocked while [FIX: …] is still in the reply", () => {
  assert.match(approvalProblem(`Sorry. ${FIX_PLACEHOLDER} Call me.`) ?? "", /FIX/);
  assert.equal(approvalProblem("Sorry. We have replaced the geyser. Call me."), null);
  assert.ok(approvalProblem("   "));
});

test("fallback drafts obey the rules themselves", () => {
  const cases = [
    { rating: 5, reviewText: "Beautiful garden and very calm." },
    { rating: 5, reviewText: null },
    { rating: 2, reviewText: "Room was dirty." },
    { rating: 1, reviewText: null },
  ];
  for (const review of cases) {
    const draft = fallbackDraft({ reviewerName: "Riya Ghosh", ...review, recentReplies: [] });
    assert.deepEqual(checkDraft({ draft, ...review, recentReplies: [] }), [], `${review.rating} ${review.reviewText}`);
  }
});

test("fallback drafts avoid repeating the last replies", () => {
  const first = fallbackDraft({ reviewerName: "Riya", rating: 5, reviewText: null, recentReplies: [] });
  const second = fallbackDraft({ reviewerName: "Riya", rating: 5, reviewText: null, recentReplies: [first] });
  assert.notEqual(first, second);
});

test("spelling alternates and is applied to the draft", () => {
  assert.equal(nextSpelling("Santiniketan"), "Shantiniketan");
  assert.equal(nextSpelling("Shantiniketan"), "Santiniketan");
  assert.equal(nextSpelling(null), "Santiniketan");
  assert.equal(applySpelling("Come back to santiniketan soon", "Shantiniketan"), "Come back to Shantiniketan soon");
});

test("finishDraft strips quotes and ensures our sign-off", () => {
  const out = finishDraft('"Thank you, Riya. Do come back.\n\n- Sourja"', "Santiniketan");
  assert.ok(out.endsWith(SIGN_OFF));
  assert.ok(!out.startsWith('"'));
  assert.equal(out.match(/Sourja/g)?.length, 1);
});

/* ------------------------------ reviews in ---------------------------- */

test("star ratings from Google's words", () => {
  assert.equal(starRating("FIVE"), 5);
  assert.equal(starRating("ONE"), 1);
  assert.equal(starRating("STAR_RATING_UNSPECIFIED"), null);
  assert.equal(starRating(4), 4);
});

test("duplicate review ids are ignored, also within one batch", () => {
  const fetched = [{ reviewId: "r1" }, { reviewId: "r2" }, { reviewId: "r2" }, { reviewId: "r3" }];
  assert.deepEqual(onlyNewReviews(fetched, ["r1"]).map((r) => r.reviewId), ["r2", "r3"]);
});
