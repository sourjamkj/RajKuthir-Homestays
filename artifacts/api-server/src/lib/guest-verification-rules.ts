/**
 * The rules behind guest pre-arrival verification, with no database in them.
 *
 * This file deliberately imports NOTHING. The deadline arithmetic and the
 * readiness ladder are the parts most likely to be got wrong and most worth
 * testing, and while they lived inside guest-onboarding-repo.ts they could not
 * be tested at all without a live Postgres — so in practice they never were.
 * They are separated so guest-verification-rules.test.ts can execute them
 * directly.
 */

/**
 * The house's published hours, Asia/Kolkata: check-in from 12:00, check-out by
 * 11:00.
 *
 * These are not arbitrary. They are what the house rules page states
 * ("Check-in from 12:00 PM, check-out by 11:00 AM") and what the
 * LodgingBusiness structured data emits as checkinTime / checkoutTime. An
 * earlier version of this code assumed check-in was 11:00, which set every
 * verification deadline an hour early and told guests to arrive an hour before
 * the house opens. If the hours change, the house rules page, the structured
 * data and these constants move together.
 */
export const CHECK_IN_LOCAL = "12:00:00+05:30";
export const CHECK_OUT_LOCAL = "11:00:00+05:30";

/** How long before check-in a guest must have completed verification. */
export const VERIFICATION_LEAD_HOURS = 48;

/** How long a link stays usable once the stay it belongs to is already over. */
export const LINK_TTL_DAYS = 30;

/**
 * The deadline: exactly 48 hours before the scheduled check-in time.
 *
 * Returns a real instant, not a date string, because "48 hours before noon IST
 * on the 17th" is a moment in time and the server runs in UTC.
 */
export function verificationDeadline(checkIn: string): Date {
  const d = new Date(`${checkIn}T${CHECK_IN_LOCAL}`);
  d.setTime(d.getTime() - VERIFICATION_LEAD_HOURS * 60 * 60 * 1000);
  return d;
}

/**
 * When the guest's link stops working: check-out, or a short rolling window if
 * the stay is already in the past, so a late submission chased up by the owner
 * still has somewhere to land.
 */
export function linkExpiry(checkOut: string, now = new Date()): Date {
  const checkOutAt = new Date(`${checkOut}T${CHECK_OUT_LOCAL}`);
  return checkOutAt.getTime() > now.getTime()
    ? checkOutAt
    : new Date(now.getTime() + LINK_TTL_DAYS * 86400000);
}

/**
 * How long a guest gets when the owner re-issues a link late in the day.
 *
 * The normal deadline is 48 hours before check-in and it is computed from the
 * booking, not from when the link was sent — so a link issued (or re-issued)
 * inside that window would arrive already expired. That is the right answer
 * for a guest who simply left it too late, and the wrong answer when the OWNER
 * is the one asking again: rejecting a blurred Aadhaar card two days before
 * arrival must not lock the guest out of replacing it.
 *
 * So a re-issued link is valid for at least this long, and never past
 * check-out — the owner asking again is itself the authority to ask.
 */
export const RESEND_GRACE_HOURS = 12;

/**
 * The deadline to stamp on a link being issued now.
 *
 * Normally the 48-hours-before-check-in rule. If that moment has already
 * passed, the guest gets the grace window instead, capped at check-out.
 */
export function deadlineForIssue(
  checkIn: string,
  checkOut: string,
  now = new Date(),
): Date {
  const standard = verificationDeadline(checkIn);
  if (standard.getTime() > now.getTime()) return standard;

  const grace = new Date(now.getTime() + RESEND_GRACE_HOURS * 60 * 60 * 1000);
  const checkOutAt = new Date(`${checkOut}T${CHECK_OUT_LOCAL}`);
  return grace.getTime() < checkOutAt.getTime() ? grace : checkOutAt;
}

/** True once the guest may no longer submit. */
export function deadlinePassed(deadline: Date, now = new Date()): boolean {
  return now.getTime() >= deadline.getTime();
}

export type DocumentCounts = {
  /**
   * Named `count`, not `total`. "Total" is a money word in this codebase and
   * the management leak check rejects it as a key — correctly, since a field
   * called total is exactly what a stray booking amount would be called.
   */
  count: number;
  submitted: number;
  verified: number;
  rejected: number;
};

export type Readiness =
  | "ready"
  | "documents_submitted"
  | "awaiting_documents"
  | "deadline_passed"
  | "blocked";

/**
 * Operational readiness for one stay.
 *
 * Order matters. "blocked" is an explicit decision and outranks everything.
 * A fully verified stay is ready even if the paperwork landed late — refusing
 * a guest who complied, merely because the clock moved, would be the system
 * inventing a policy. And a passed deadline is REPORTED, never acted on: this
 * function does not cancel bookings, refuse refunds or decide anything. The
 * property does that.
 */
export function readinessOf(input: {
  onboardingStatus: string | null;
  verificationDeadline: Date | null;
  documents: DocumentCounts;
  now?: Date;
}): Readiness {
  const now = input.now ?? new Date();

  if (input.onboardingStatus === "blocked") return "blocked";

  // Every live document verified means ready. Since documents are marked
  // verified the moment a guest completes an upload, this is normally reached
  // without the owner doing anything — the owner's part is the veto, not the
  // gate. A rejection un-verifies the documents and puts the stay back to
  // awaiting_documents, which is the truthful state: new ones are wanted.
  if (input.documents.count > 0 && input.documents.verified === input.documents.count) {
    return "ready";
  }

  if (input.verificationDeadline && deadlinePassed(input.verificationDeadline, now)) {
    return "deadline_passed";
  }

  if (input.documents.submitted > 0) return "documents_submitted";

  return "awaiting_documents";
}

/**
 * Keys that must never appear in a management payload.
 *
 * Exported so the tests assert against the same list the code is written to,
 * rather than a second copy that can drift out of step with it.
 */
export const MANAGEMENT_FORBIDDEN_KEYS = [
  "grossPaise",
  "receivedPaise",
  "commissionPaise",
  "taxPaise",
  "gross_paise",
  "received_paise",
  "commission_paise",
  "tax_paise",
  "total",
  "advance",
  "balance",
  "amount",
  "price",
  "paise",
  "commission",
  "tax",
  "payment",
] as const;

/**
 * Substrings that mean money wherever they appear in a key name. Kept separate
 * from the exact-match list because matching those as substrings produced a
 * false positive on `documents.total` — a count of uploaded IDs, not a sum of
 * rupees. A detector that cries wolf gets switched off, so it matches exactly
 * on ambiguous words and loosely only on these.
 */
const MONEY_SUBSTRINGS = [
  "paise",
  "commission",
  "gross",
  "received",
  "advance",
  "balance",
  "payment",
] as const;

/**
 * Walks any value and reports forbidden keys, or a rupee amount hiding in a
 * string. Used by the tests against a real DTO, and cheap enough to use as a
 * runtime assertion if that is ever wanted.
 */
export function financialLeaks(value: unknown, path = "$"): string[] {
  const found: string[] = [];

  if (typeof value === "string") {
    if (/₹\s?\d|(?:Rs\.?|INR)\s?\d/i.test(value)) found.push(`${path}: rupee amount in string`);
    return found;
  }

  if (Array.isArray(value)) {
    value.forEach((item, i) => found.push(...financialLeaks(item, `${path}[${i}]`)));
    return found;
  }

  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const lower = key.toLowerCase();
      const exact = MANAGEMENT_FORBIDDEN_KEYS.some((banned) => lower === banned.toLowerCase());
      const loose = MONEY_SUBSTRINGS.some((banned) => lower.includes(banned));
      if (exact || loose) found.push(`${path}.${key}: forbidden key`);
      found.push(...financialLeaks(item, `${path}.${key}`));
    }
  }

  return found;
}
