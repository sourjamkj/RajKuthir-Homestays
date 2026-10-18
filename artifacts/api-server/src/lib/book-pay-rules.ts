import { createHash, randomBytes } from "node:crypto";

import { firstConflict, rangesOverlap, type DateRange } from "./availability.ts";
import { bytesMatchMime } from "./document-security.ts";
import { nightsOf } from "./enquiry-quote.ts";
import type { MergedEvent } from "./calendar-bookings.ts";

/**
 * The rules behind self-serve Book & Pay by UPI, with no database in them.
 *
 * Everything that decides money, dates or state lives here so it is tested
 * by book-pay-rules.test.ts in milliseconds. book-pay-repo.ts does the
 * querying; routes/book.ts does the HTTP. Neither re-implements a rule.
 */

/* ---------------------------- db errors -------------------------------- */

/** Postgres error code, whether or not the driver wrapped the error. */
export function pgCode(error: unknown): string | undefined {
  const own = (error as { code?: string } | null)?.code;
  if (own) return own;
  return (error as { cause?: { code?: string } } | null)?.cause?.code;
}

/** 23505: the unique index said no — for a UTR, "already used". */
export const isUniqueViolation = (error: unknown) => pgCode(error) === "23505";

/** 42P01 undefined_table / 42704 undefined_object: the migration has not run. */
export const isNotMigrated = (error: unknown) => {
  const code = pgCode(error);
  return code === "42P01" || code === "42704";
};

/* ----------------------------- settings -------------------------------- */

export type BookPaySettings = {
  /** Share of the total paid up front to hold the booking. */
  advancePercent: number;
  /** Minutes the dates are held while the guest pays. */
  holdMinutes: number;
};

export const DEFAULT_BOOK_PAY_SETTINGS: BookPaySettings = {
  advancePercent: 50,
  holdMinutes: 30,
};

/** Hours a hold is stretched to once the guest says they have paid. */
export const SUBMITTED_HOLD_HOURS = 12;

export function settingsProblem(settings: BookPaySettings): string | null {
  const { advancePercent, holdMinutes } = settings;
  if (!Number.isInteger(advancePercent) || advancePercent < 10 || advancePercent > 100) {
    return "The advance must be a whole percentage between 10 and 100.";
  }
  if (!Number.isInteger(holdMinutes) || holdMinutes < 10 || holdMinutes > 24 * 60) {
    return "The hold must be between 10 minutes and 24 hours.";
  }
  return null;
}

/** Stored JSON, read defensively: a bad value falls back, it never throws. */
export function parseSettings(raw: string | null | undefined): BookPaySettings {
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<BookPaySettings>) : {};
    const merged = { ...DEFAULT_BOOK_PAY_SETTINGS, ...parsed };
    return settingsProblem(merged) ? DEFAULT_BOOK_PAY_SETTINGS : merged;
  } catch {
    return DEFAULT_BOOK_PAY_SETTINGS;
  }
}

/* ------------------------------ tokens --------------------------------- */

/** 32 random bytes, URL-safe. The bearer credential in the /pay link. */
export function newPayToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What the database stores instead of the token. */
export function hashPayToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function looksLikePayToken(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{43}$/.test(raw);
}

/* -------------------------------- UTR ---------------------------------- */

/**
 * A UPI transaction reference (UTR / RRN) is exactly 12 digits. Spaces and
 * dashes from copy-paste are forgiven; anything else is refused.
 */
export function normaliseUtr(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{12}$/.test(digits) ? digits : null;
}

/* ---------------------------- UPI intent ------------------------------- */

/** Paise to the "1600.00" UPI expects — two decimals, no grouping. */
export function upiAmount(paise: number): string {
  return (paise / 100).toFixed(2);
}

/**
 * upi://pay?pa=…&pn=…&am=…&cu=INR&tn=…
 *
 * `@` in the payee address is left literal: several UPI apps fail to decode
 * %40 and reject the handle. Everything else is percent-encoded.
 */
export function upiIntentUrl(input: {
  upiId: string;
  payeeName: string;
  amountPaise: number;
  note: string;
}): string {
  const enc = (value: string) => encodeURIComponent(value).replace(/%40/g, "@");
  return (
    `upi://pay?pa=${enc(input.upiId)}` +
    `&pn=${enc(input.payeeName)}` +
    `&am=${upiAmount(input.amountPaise)}` +
    `&cu=INR` +
    `&tn=${enc(input.note)}`
  );
}

/* ------------------------------- holds --------------------------------- */

export type PaymentStatus =
  | "awaiting_payment"
  | "submitted"
  | "confirmed"
  | "rejected"
  | "expired";

export type HoldRow = {
  id: string;
  status: PaymentStatus;
  holdExpiresAt: Date;
  checkIn: string;
  checkOut: string;
};

/**
 * Whether a self-serve request is keeping its dates off sale right now.
 *
 * - awaiting payment: until the deadline, then never again (derived, so a
 *   missed cron run cannot leave dates stuck).
 * - submitted: until the OWNER decides. The guest says money has left their
 *   account; releasing the dates under them would be the worst outcome. The
 *   deadline is still shown so an overdue decision stands out.
 * - confirmed: the booking row blocks the dates from here on, not the hold.
 * - rejected / expired: free.
 */
export function holdBlocks(row: Pick<HoldRow, "status" | "holdExpiresAt">, now: Date): boolean {
  if (row.status === "submitted") return true;
  if (row.status === "awaiting_payment") return now.getTime() < row.holdExpiresAt.getTime();
  return false;
}

export function liveHoldRanges(rows: HoldRow[], now: Date): Array<DateRange & { id: string }> {
  return rows
    .filter((row) => holdBlocks(row, now))
    .map((row) => ({ id: row.id, startDate: row.checkIn, endDate: row.checkOut }));
}

/**
 * Live holds as calendar entries, for the public calendar and the iCal
 * export the OTAs read. The id ends in "-hold" so it can never match a real
 * calendar_events row or a booking-derived one; source "direct" so no OTA
 * ever has it excluded as its own echo.
 */
export function holdsAsEvents(
  holds: Array<{ id: string; startDate: string; endDate: string }>,
  now = new Date(),
): MergedEvent[] {
  return holds.map((hold) => ({
    id: `${hold.id}-hold`,
    source: "direct" as const,
    externalUid: null,
    startDate: hold.startDate,
    endDate: hold.endDate,
    status: "confirmed" as const,
    title: "Held — payment in progress",
    note: null,
    createdAt: now,
    updatedAt: now,
    origin: "booking" as const,
  }));
}

/** Requests whose hold ran out without a UTR: release and tell the guest. */
export function dueForExpiry<T extends Pick<HoldRow, "status" | "holdExpiresAt">>(
  rows: T[],
  now: Date,
): T[] {
  return rows.filter(
    (row) => row.status === "awaiting_payment" && now.getTime() >= row.holdExpiresAt.getTime(),
  );
}

/** The deadline once a UTR arrives: never shortened, at least 12 hours out. */
export function extendedHold(current: Date, now: Date): Date {
  const floor = now.getTime() + SUBMITTED_HOLD_HOURS * 3_600_000;
  return new Date(Math.max(current.getTime(), floor));
}

export function holdExpiry(now: Date, settings: BookPaySettings): Date {
  return new Date(now.getTime() + settings.holdMinutes * 60_000);
}

/** Whole seconds left, never negative. What the /pay countdown starts from. */
export function secondsLeft(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
}

/* ------------------------- availability helpers ------------------------ */

function addDays(iso: string, days: number): string {
  const at = new Date(`${iso}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * The first stays of the same length, on or after the requested check-in,
 * that touch no taken night. Up to `limit` suggestions within `horizonDays`.
 * Each suggestion starts after the previous one ends, so they are genuinely
 * different options rather than one gap offered three times.
 */
export function nextFreeWindows(
  wanted: DateRange,
  taken: readonly DateRange[],
  options: { today: string; limit?: number; horizonDays?: number; minNights?: number } = {
    today: wanted.startDate,
  },
): DateRange[] {
  const length = Math.max(nightsOf(wanted.startDate, wanted.endDate).length, options.minNights ?? 1);
  const limit = options.limit ?? 3;
  const horizon = options.horizonDays ?? 180;

  const found: DateRange[] = [];
  let start = wanted.startDate > options.today ? wanted.startDate : options.today;
  const lastStart = addDays(start, horizon);

  while (found.length < limit && start <= lastStart) {
    const candidate = { startDate: start, endDate: addDays(start, length) };
    const clash = firstConflict(candidate, taken);
    if (!clash) {
      found.push(candidate);
      start = candidate.endDate;
    } else {
      // Jump straight past the clash rather than walking day by day.
      start = clash.endDate > start ? clash.endDate : addDays(start, 1);
    }
  }

  return found;
}

/** True when the stay touches any of the ranges. Re-exported for the repo. */
export function clashesWith(stay: DateRange, taken: readonly DateRange[]): DateRange | null {
  return firstConflict(stay, taken);
}

export { rangesOverlap };

/* ---------------------------- screenshot ------------------------------- */

export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const SCREENSHOT_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ScreenshotMime = (typeof SCREENSHOT_MIMES)[number];

export type ScreenshotCheck =
  | { ok: true; mime: ScreenshotMime; bytes: Buffer }
  | { ok: false; reason: string };

/**
 * Optional payment screenshot. Images only, 5 MB, and the bytes must be what
 * they claim — the same magic-number check the pre-arrival documents use.
 */
export function checkScreenshot(input: { mimeType?: unknown; dataBase64?: unknown }): ScreenshotCheck {
  const mime = typeof input.mimeType === "string" ? input.mimeType.trim().toLowerCase() : "";
  if (!(SCREENSHOT_MIMES as readonly string[]).includes(mime)) {
    return { ok: false, reason: "The screenshot must be a JPG, PNG or WebP image." };
  }
  if (typeof input.dataBase64 !== "string" || !input.dataBase64) {
    return { ok: false, reason: "The screenshot could not be read." };
  }
  if (Math.floor((input.dataBase64.length * 3) / 4) > MAX_SCREENSHOT_BYTES + 3) {
    return { ok: false, reason: "The screenshot is larger than 5 MB." };
  }
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (!bytes.length) return { ok: false, reason: "The screenshot could not be read." };
  if (bytes.length > MAX_SCREENSHOT_BYTES) return { ok: false, reason: "The screenshot is larger than 5 MB." };
  if (!bytesMatchMime(bytes, mime as ScreenshotMime)) {
    return { ok: false, reason: "That file is not the image it claims to be." };
  }
  return { ok: true, mime: mime as ScreenshotMime, bytes };
}

/* ------------------------- what the guest sees ------------------------- */

/**
 * The status line on /pay. Never says "confirmed" until the owner has
 * confirmed: a guest told their booking is confirmed when the money has not
 * been seen is a promise this server cannot keep.
 */
export function guestStatusText(status: PaymentStatus, expired: boolean): string {
  switch (status) {
    case "awaiting_payment":
      return expired
        ? "This hold has expired and the dates have been released."
        : "Dates held. Pay the advance and enter your UPI transaction ID below.";
    case "submitted":
      return "Payment submitted — we'll confirm within a few hours.";
    case "confirmed":
      return "Booking confirmed. Your booking reference and pre-arrival link have been sent to you.";
    case "rejected":
      return "We could not match this payment. Please call us and we will sort it out.";
    case "expired":
      return "This hold has expired and the dates have been released.";
  }
}
