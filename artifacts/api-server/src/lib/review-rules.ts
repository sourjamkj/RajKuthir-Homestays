/**
 * Google reviews: who is asked, when, with which words, and what a reply to
 * a review may and may not say.
 *
 * Pure: no database, no network, no environment. Everything here is decided
 * from its arguments so review-rules.test.ts can pin every rule down. The
 * scheduler (review-requests.ts) and the reply drafter (review-drafter.ts)
 * do the I/O and ask this file what to do.
 */

/* ======================================================================== *
 * Part A — review requests
 * ======================================================================== */

/** Google's "write a review" box for the listing. Same as CONFIG.leaveReviewUrl on the site. */
export const LEAVE_REVIEW_URL = "https://g.page/r/CR9H9DboJM75EBM/review";

/** The listing on Google Maps, where the owner pastes a reply by hand. */
export const LISTING_URL = "https://maps.app.goo.gl/Ptrm6eaXuXNoiXBbA?g_st=ac";

export const HOST_PHONE = "+91 62903 99165";

export type ReviewVariant = "general" | "pet" | "short";

export const REVIEW_TEMPLATE_NAMES: Record<ReviewVariant, string> = {
  general: "rk_review_general",
  pet: "rk_review_pet",
  short: "rk_review_short",
};

/** The single template approved before the three variants. Same two params. */
export const LEGACY_REVIEW_TEMPLATE = "rk_review_request";

export function variantFromTemplateName(name: string): ReviewVariant | null {
  for (const [variant, template] of Object.entries(REVIEW_TEMPLATE_NAMES)) {
    if (template === name) return variant as ReviewVariant;
  }
  return null;
}

/**
 * Pets first, then one-night stays, else the general message. The reason is
 * shown to the owner beside the draft.
 */
export function pickReviewVariant(input: {
  pets: number | null;
  nights: number;
}): { variant: ReviewVariant; reason: string } {
  const pets = input.pets ?? 0;
  if (pets > 0) {
    return { variant: "pet", reason: `Booked with ${pets} pet${pets === 1 ? "" : "s"}` };
  }
  if (input.nights === 1) {
    return { variant: "short", reason: "1-night stay" };
  }
  return {
    variant: "general",
    reason: `${input.nights}-night stay without pets (families, groups, couples)`,
  };
}

export function firstName(full: string | null | undefined): string {
  const name = (full ?? "").trim().split(/\s+/)[0];
  return name || "there";
}

/**
 * The words of each variant, exactly as submitted to Meta, with {{1}} the
 * guest's first name and {{2}} the review link. The same message goes to
 * every guest: nothing here asks only happy guests to review.
 */
export function reviewRequestText(variant: ReviewVariant, guest: string, url = LEAVE_REVIEW_URL): string {
  switch (variant) {
    case "general":
      return (
        `Hi ${guest}, thank you for staying with us at Raj Kuthir Homestays – Sobuj Potro. ` +
        `We hope you reached home safely and enjoyed your time in Santiniketan. ` +
        `Google reviews help other travellers find our private 2-bedroom villa. ` +
        `If you have a minute, we'd really appreciate a few words about your stay: ${url} ` +
        `Even a line about what you liked most helps future guests know what to expect. ` +
        `Warm Regards, Sourja Mukherjee, Raj Kuthir Homestays – Sobuj Potro`
      );
    case "pet":
      return (
        `Hi ${guest}, it was a pleasure hosting you and your pet at Raj Kuthir Homestays – Sobuj Potro. ` +
        `We hope the drive home was smooth. ` +
        `Finding a genuinely pet-friendly stay in Bolpur is hard for many pet parents, ` +
        `so your review would help them a lot: ${url} ` +
        `Feel free to mention how your pet took to the garden. ` +
        `Warm Regards, Sourja Mukherjee, Raj Kuthir Homestays – Sobuj Potro`
      );
    case "short":
      return (
        `Namaskar ${guest}, thank you for choosing Raj Kuthir Homestays – Sobuj Potro for your Santiniketan getaway. ` +
        `Could you share a quick Google review of your stay? ${url} ` +
        `Your favourite part, in a line, helps other travellers find us on Google Maps. ` +
        `Warm Regards, Sourja Mukherjee, Raj Kuthir Homestays – Sobuj Potro`
      );
  }
}

/* ------------------------------ timing -------------------------------- */

/** Asia/Kolkata is UTC+5:30 with no DST. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

export function istMoment(isoDate: string, hour: number): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!, hour, 0) - IST_OFFSET_MS);
}

export function istDateOf(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const at = new Date(`${isoDate}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** The last moment a review request may go out: 3 days after the 11 am check-out. */
export function reviewCutoff(checkOut: string): Date {
  return istMoment(addDays(checkOut, 3), 11);
}

/**
 * Check-out day at 14:00 IST, about three hours after the 11 am check-out.
 * If that has passed by the time the booking is first scheduled, the next
 * 11:00 IST instead — unless that falls after the 3-day cut-off, in which
 * case null: too late to ask.
 */
export function reviewSendTime(checkOut: string, now: Date): Date | null {
  const target = istMoment(checkOut, 14);
  if (now.getTime() <= target.getTime()) return target;

  const today = istDateOf(now);
  const todayAt11 = istMoment(today, 11);
  const next11 = now.getTime() < todayAt11.getTime() ? todayAt11 : istMoment(addDays(today, 1), 11);

  return next11.getTime() <= reviewCutoff(checkOut).getTime() ? next11 : null;
}

/* ---------------------------- eligibility ------------------------------ */

export const OTA_SOURCES = ["bookingCom", "airbnb", "makeMyTrip"] as const;

export function isOtaSource(source: string): boolean {
  return (OTA_SOURCES as readonly string[]).includes(source);
}

export const SUPPRESSION_DAYS = 180;

export type ReviewDecision =
  /** Queue it. Always as a draft: review asks are marketing and wait for the owner. */
  | { ok: true; sendAfter: Date; note: string | null }
  /**
   * Don't queue. `persist` means record the skip on the queue so the owner can
   * see why, and so the scheduler stops reconsidering it; transient reasons
   * (not checked out yet, no number yet) are only logged and retried.
   */
  | { ok: false; reason: string; persist: boolean; ownerTask?: boolean };

export function decideReviewRequest(input: {
  status: string;
  checkOut: string;
  source: string;
  /** toWhatsappNumber(guestPhone) — null when unusable. */
  whatsappNumber: string | null;
  /** An open "issue during stay" flag on the booking. */
  issueOpen: boolean;
  optedOut: boolean;
  /** When this number last received a review request, from any booking. */
  lastSentToNumberAt: Date | null;
  /** Another booking for this number already has an unsent draft or pending ask. */
  openRequestForNumber: boolean;
  now: Date;
}): ReviewDecision {
  if (input.status !== "confirmed") {
    return { ok: false, reason: `Booking is ${input.status}, not confirmed`, persist: false };
  }
  if (input.checkOut > istDateOf(input.now)) {
    return { ok: false, reason: "Guest has not checked out yet", persist: false };
  }
  if (!input.whatsappNumber) {
    return { ok: false, reason: "No valid WhatsApp number on the booking", persist: false };
  }
  if (input.issueOpen) {
    return {
      ok: false,
      reason: "Issue during stay flagged — call the guest first",
      persist: false,
      ownerTask: true,
    };
  }
  if (input.optedOut) {
    return { ok: false, reason: "Guest opted out of marketing messages", persist: true };
  }
  if (
    input.lastSentToNumberAt &&
    input.now.getTime() - input.lastSentToNumberAt.getTime() < SUPPRESSION_DAYS * 86_400_000
  ) {
    return {
      ok: false,
      reason: `Already asked this number on ${istDateOf(input.lastSentToNumberAt)} (within ${SUPPRESSION_DAYS} days)`,
      persist: true,
    };
  }
  if (input.openRequestForNumber) {
    return { ok: false, reason: "Another stay for this number already has a review request waiting", persist: true };
  }

  const sendAfter = reviewSendTime(input.checkOut, input.now);
  if (!sendAfter) {
    return { ok: false, reason: "More than 3 days after check-out — too late to ask", persist: true };
  }

  return {
    ok: true,
    sendAfter,
    note: isOtaSource(input.source)
      ? "OTA booking — draft only. Check the channel's guest-contact rules before sending."
      : null,
  };
}

/**
 * Re-checked when a released ask is about to go out, because the owner may
 * approve a draft days after it was queued.
 */
export function stillSendable(input: {
  bookingStatus: string | null;
  checkOut: string | null;
  issueOpen: boolean;
  now: Date;
}): { ok: true } | { ok: false; reason: string } {
  if (input.bookingStatus !== "confirmed" || !input.checkOut) {
    return { ok: false, reason: "Booking is no longer confirmed" };
  }
  if (input.issueOpen) return { ok: false, reason: "Issue during stay flagged after queueing" };
  if (input.now.getTime() > reviewCutoff(input.checkOut).getTime()) {
    return { ok: false, reason: "Past the 3-day window after check-out" };
  }
  return { ok: true };
}

/* ======================================================================== *
 * Part B — replies to Google reviews
 * ======================================================================== */

export const SIGN_OFF = "– Sourja, Raj Kuthir Homestays – Sobuj Potro";

/* ------------------------- matching to a stay -------------------------- */

function nameTokens(name: string | null | undefined): string[] {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

/**
 * "Same or similar" name: the whole name equal, or the first names equal, or
 * any word of three letters or more in common ("Prasun S." / "Prasun Singha
 * Roy"; "Riya" / "Riya Ghosh").
 */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = nameTokens(a);
  const right = nameTokens(b);
  if (!left.length || !right.length) return false;
  if (left.join(" ") === right.join(" ")) return true;
  if (left[0] === right[0] && left[0]!.length >= 3) return true;
  return left.some((token) => token.length >= 3 && right.includes(token));
}

export type MatchCandidate = { id: string; guestName: string | null; checkOut: string; pets: number | null };

/**
 * The stay a review is probably about: a similar name, and a check-out in
 * the 21 days up to and including the review date. Closest check-out wins.
 * Used only to personalise the draft, never to put stay details in it.
 */
export function matchReviewToBooking<T extends MatchCandidate>(
  review: { reviewerName: string | null; reviewDate: string },
  candidates: T[],
): T | null {
  const earliest = addDays(review.reviewDate, -21);
  const inWindow = candidates.filter(
    (booking) =>
      booking.checkOut <= review.reviewDate &&
      booking.checkOut >= earliest &&
      namesMatch(review.reviewerName, booking.guestName),
  );
  inWindow.sort((a, b) => b.checkOut.localeCompare(a.checkOut));
  return inWindow[0] ?? null;
}

/* ------------------------------ tone ---------------------------------- */

const COMPLAINT_WORDS =
  /\b(dirty|unclean|not clean|smell\w*|stink\w*|broken|rude|noisy|noise|mosquito\w*|cockroach\w*|insects?|bugs?|leak\w*|disappoint\w*|worst|terrible|horrible|awful|poor|bad|issues?|problems?|complain\w*|overpriced|unhygienic|no water|no hot water|not working|didn'?t work|stained|damp|uncomfortable|unhelpful|unprofessional|refund)\b/gi;

/** "no issues", "nothing bad", "without any problem" are praise, not complaints. */
const NEGATED = /\b(no|not|nothing|without|never|zero|any|none|n't)\W+(\w+\W+)?$/i;

export function isComplaint(rating: number, text: string | null | undefined): boolean {
  if (rating <= 3) return true;
  const review = text ?? "";
  for (const match of review.matchAll(COMPLAINT_WORDS)) {
    const before = review.slice(Math.max(0, match.index - 30), match.index);
    const phraseIsNegative = /^(not |no |didn)/i.test(match[0]);
    if (phraseIsNegative || !NEGATED.test(before)) return true;
  }
  return false;
}

/* ------------------------- place-name spelling ------------------------- */

export type PlaceSpelling = "Santiniketan" | "Shantiniketan";

const PLACE_NAMES = /\b(santiniketan|shantiniketan|bolpur|sonajhuri)\b/gi;

export function nextSpelling(last: string | null | undefined): PlaceSpelling {
  return last === "Santiniketan" ? "Shantiniketan" : "Santiniketan";
}

/** Writes either spelling of Santiniketan the way this reply should. */
export function applySpelling(text: string, spelling: PlaceSpelling): string {
  return text.replace(/\b(santiniketan|shantiniketan)\b/gi, spelling);
}

export function placeSpellingUsed(text: string): PlaceSpelling | null {
  const match = /\b(santiniketan|shantiniketan)\b/i.exec(text);
  if (!match) return null;
  return match[1]!.toLowerCase() === "shantiniketan" ? "Shantiniketan" : "Santiniketan";
}

/* --------------------------- the guard rails --------------------------- */

export const FIX_PLACEHOLDER = "[FIX: owner to fill]";

export function hasFixPlaceholder(text: string | null | undefined): boolean {
  return /\[FIX\b/i.test(text ?? "");
}

/**
 * Things a reply may only mention when the reviewer did. Each is a pattern
 * for the reply, checked against the review's own text.
 */
const ONLY_IF_REVIEWER_SAID: Array<{ label: string; pattern: RegExp }> = [
  { label: "Cafe Soi / the café", pattern: /\b(cafe|café|soi)\b/i },
  { label: "the kitchen", pattern: /\bkitchen\b/i },
  { label: "Prantik", pattern: /\bprantik\b/i },
];

const DISTANCE_OR_TIME = /\b\d+(\.\d+)?\s*(km|kms|kilomet\w*|mins?|minutes?|hours?|hrs?)\b|\b(walking distance|minutes? away|minutes? from|drive from|close to the station)\b/i;
const MONEY_TALK = /\b(discount\w*|coupon\w*|% ?off|offer\w*|complimentary|free (night|stay)|promo\w*)\b/i;
const PROMISES = /\b(promise\w*|guarantee\w*|we will ensure|we'll ensure|never happen again)\b/i;
const EMOJI = /\p{Extended_Pictographic}/u;

function normaliseForCompare(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function bodyOf(reply: string): string {
  const at = reply.lastIndexOf(SIGN_OFF);
  return (at >= 0 ? reply.slice(0, at) : reply).trim();
}

function sentenceCount(text: string): number {
  return text
    .replace(/\[FIX[^\]]*\]/gi, "placeholder.")
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => /[a-z]/i.test(part)).length;
}

/**
 * Everything wrong with a draft, as owner-readable lines. Empty means it may
 * go to the owner for approval.
 */
export function checkDraft(input: {
  draft: string;
  reviewText: string | null;
  rating: number;
  recentReplies: string[];
}): string[] {
  const problems: string[] = [];
  const draft = input.draft.trim();
  const review = input.reviewText ?? "";
  const body = bodyOf(draft);

  if (!draft.endsWith(SIGN_OFF)) problems.push(`Must end with the sign-off "${SIGN_OFF}".`);

  for (const rule of ONLY_IF_REVIEWER_SAID) {
    if (rule.pattern.test(body) && !rule.pattern.test(review)) {
      problems.push(`Mentions ${rule.label}, which the reviewer did not.`);
    }
  }
  if (DISTANCE_OR_TIME.test(body) && !DISTANCE_OR_TIME.test(review)) {
    problems.push("Claims a distance or travel time.");
  }
  if (MONEY_TALK.test(body)) problems.push("Mentions a discount or offer.");
  if (PROMISES.test(body)) problems.push("Makes a promise.");
  if (EMOJI.test(draft)) problems.push("Contains an emoji.");

  const places = body.match(PLACE_NAMES) ?? [];
  if (places.length > 1) problems.push("Uses more than one place name.");

  const sentences = sentenceCount(body);
  const complaint = isComplaint(input.rating, review);
  if (!review.trim() && !complaint) {
    if (sentences > 1) problems.push("A rating-only review gets one short sentence.");
  } else if (sentences < 2 || sentences > 4) {
    problems.push(`Should be 2–4 sentences (has ${sentences}).`);
  }

  if (complaint && !hasFixPlaceholder(draft)) {
    problems.push(`A complaint reply needs the ${FIX_PLACEHOLDER} placeholder for the owner.`);
  }

  const mine = normaliseForCompare(draft);
  if (input.recentReplies.some((reply) => normaliseForCompare(reply) === mine)) {
    problems.push("Identical to a recent reply.");
  }

  return problems;
}

/** Approval is refused while the owner has not replaced the [FIX: …] placeholder. */
export function approvalProblem(reply: string | null | undefined): string | null {
  const text = (reply ?? "").trim();
  if (!text) return "Write a reply first.";
  if (hasFixPlaceholder(text)) return "Replace the [FIX: …] placeholder with what you have done about it before approving.";
  if (text.length > 4000) return "Google allows replies up to 4,000 characters.";
  return null;
}

/* ------------------------ fallback (no model) -------------------------- */

const POSITIVE_FALLBACKS = [
  "Thank you so much for taking the time to write about your stay, {name}. It means a lot to us, and we would love to welcome you back.",
  "Thank you for the lovely review, {name}. We are glad the stay worked well for you and hope to host you again soon.",
  "{name}, thank you for sharing your experience with other travellers. We hope to see you back at Sobuj Potro.",
];

const RATING_ONLY_FALLBACKS = [
  "Thank you for the rating, {name}.",
  "Thank you for taking the time to rate us, {name}.",
  "Many thanks for the rating, {name}.",
];

function withName(template: string, name: string): string {
  return template.replaceAll("{name}", name);
}

function firstUnused(options: string[], recentReplies: string[]): string {
  const recent = new Set(recentReplies.map(normaliseForCompare));
  return options.find((option) => !recent.has(normaliseForCompare(option))) ?? options[0]!;
}

/**
 * A draft that obeys every rule without a language model: used when
 * ANTHROPIC_API_KEY is not set, the call fails, or the model's draft fails
 * checkDraft twice. Plainer than a model's, and the owner can edit it.
 */
export function fallbackDraft(input: {
  reviewerName: string | null;
  rating: number;
  reviewText: string | null;
  recentReplies: string[];
}): string {
  const name = firstName(input.reviewerName);
  const text = (input.reviewText ?? "").trim();

  if (isComplaint(input.rating, text)) {
    const opening = text ? "Thank you for the honest feedback" : "Thank you for your rating";
    return (
      `${opening}, ${name}. I'm sorry your stay fell short of what you expected. ` +
      `${FIX_PLACEHOLDER} Please reach me on ${HOST_PHONE}.\n\n${SIGN_OFF}`
    );
  }

  const pool = text ? POSITIVE_FALLBACKS : RATING_ONLY_FALLBACKS;
  const options = pool.map((option) => `${withName(option, name)}\n\n${SIGN_OFF}`);
  return firstUnused(options, input.recentReplies);
}

/* --------------------------- the model prompt -------------------------- */

export function draftSystemPrompt(spelling: PlaceSpelling): string {
  return [
    "You write the owner's public reply to a Google review of Raj Kuthir Homestays – Sobuj Potro, a private two-bedroom villa.",
    "",
    "Rules — follow all of them:",
    `- 2 to 4 sentences, warm and professional, then a blank line and exactly: ${SIGN_OFF}`,
    "- Thank the reviewer by first name.",
    "- Respond ONLY to things the reviewer actually wrote. Never mention Cafe Soi, a café, the kitchen, Prantik, distances, travel times or any feature the reviewer did not mention.",
    `- Use at most ONE place name in the whole reply. If you mention the town, spell it "${spelling}". Do not list places or keywords.`,
    "- No discounts, offers, promises, emojis, hashtags or keyword lists. No claims about distances or times.",
    "- Never mention the guest's stay dates, booking details, price or party size.",
    "- Rating 4 or 5 with no complaint: thank them, echo one specific thing they wrote, and invite them back.",
    `- Rating 3 or below, or any complaint: use this structure — "Thank you for the honest feedback, <name>. I'm sorry <the specific issue they raised>. ${FIX_PLACEHOLDER} Please reach me on ${HOST_PHONE}." Keep ${FIX_PLACEHOLDER} exactly as written; the owner fills it in.`,
    "- A review with no text (rating only): one short thank-you sentence, then the sign-off.",
    "- Do not repeat any of the recent replies you are shown.",
    "",
    "Reply with the reply text only — no preamble, no quotation marks.",
  ].join("\n");
}

export function draftUserPrompt(input: {
  reviewerName: string | null;
  rating: number;
  reviewText: string | null;
  stayedWithPet: boolean;
  recentReplies: string[];
  problems?: string[];
}): string {
  const lines = [
    `Reviewer first name: ${firstName(input.reviewerName)}`,
    `Rating: ${input.rating} out of 5`,
    `Review text: ${input.reviewText?.trim() ? `"""${input.reviewText.trim()}"""` : "(none — rating only)"}`,
  ];
  if (input.stayedWithPet) {
    lines.push(
      "Context: this guest stayed with a pet. Use this only to understand the review (e.g. a name in it may be their dog). Do not bring pets up unless the review does.",
    );
  }
  if (input.recentReplies.length) {
    lines.push("", "Recent replies (do not repeat them):", ...input.recentReplies.slice(0, 5).map((reply) => `- ${reply.replace(/\s+/g, " ")}`));
  }
  if (input.problems?.length) {
    lines.push("", "Your previous draft broke these rules — fix them:", ...input.problems.map((problem) => `- ${problem}`));
  }
  return lines.join("\n");
}

/** Tidies a model's output: quotes stripped, spelling applied, sign-off ensured. */
export function finishDraft(raw: string, spelling: PlaceSpelling): string {
  let text = raw.trim().replace(/^["“]|["”]$/g, "").trim();
  text = applySpelling(text, spelling);
  if (!text.endsWith(SIGN_OFF)) {
    // Drop any sign-off of the model's own, then add ours.
    text = text.replace(/\n*[–—-]\s*Sourja[^\n]*$/i, "").trim();
    text = `${text}\n\n${SIGN_OFF}`;
  }
  return text;
}

/* ----------------------------- reviews in ------------------------------ */

const STAR_WORDS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/** Google Business Profile's "FOUR" -> 4. Unknown or unspecified -> null. */
export function starRating(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return value >= 1 && value <= 5 ? Math.round(value) : null;
  return STAR_WORDS[String(value ?? "").toUpperCase()] ?? null;
}

/** Reviews not seen before, by review id; duplicates within the batch dropped too. */
export function onlyNewReviews<T extends { reviewId: string }>(fetched: T[], knownIds: Iterable<string>): T[] {
  const seen = new Set(knownIds);
  const out: T[] = [];
  for (const review of fetched) {
    if (seen.has(review.reviewId)) continue;
    seen.add(review.reviewId);
    out.push(review);
  }
  return out;
}

/** The owner's alert for a new review. Plain text: WhatsApp or email. */
export function ownerReviewAlert(input: {
  reviewerName: string | null;
  rating: number;
  reviewText: string | null;
  adminUrl: string;
}): { subject: string; text: string } {
  const stars = "★".repeat(input.rating) + "☆".repeat(Math.max(0, 5 - input.rating));
  const who = input.reviewerName?.trim() || "A guest";
  const low = input.rating <= 3;
  const excerpt = (input.reviewText ?? "").trim();
  return {
    subject: `${low ? "Low rating — " : ""}New Google review ${input.rating}★ from ${who}`,
    text: [
      `${low ? "LOW RATING. " : ""}New Google review ${stars} from ${who}.`,
      excerpt ? `"${excerpt.length > 300 ? `${excerpt.slice(0, 297)}…` : excerpt}"` : "(rating only, no text)",
      "",
      `A reply is drafted for you to check: ${input.adminUrl}`,
    ].join("\n"),
  };
}
