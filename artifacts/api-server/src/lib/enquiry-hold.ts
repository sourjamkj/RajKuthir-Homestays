/**
 * How long a quoted enquiry holds its dates.
 *
 * The hold is DERIVED, never stored. A quote carries a sent time and possibly
 * an advance-paid time; everything else — whether the dates are still held,
 * when they stop being held, how long is left — is worked out from those two
 * timestamps and the clock, every time it is asked for.
 *
 * That is a deliberate choice over a `held` flag swept by a cron job. A flag
 * has to be cleared by something that runs, and the something that runs is
 * exactly what fails: the server sleeps, the sweep double-runs, a deploy
 * lands mid-pass, and dates sit blocked for a week because a job missed its
 * turn. A derived hold cannot leak. If this server is switched off for a
 * month, every hold in the database expires correctly anyway, because expiry
 * is subtraction rather than an action anybody has to take.
 *
 * Nothing here reads the database or calls `new Date()` on its own — the
 * clock arrives as an argument, so "what will this look like in 23 hours"
 * is a test rather than a wait.
 */

/** Hours the guest has to send the advance before the dates go back on sale. */
export const HOLD_HOURS = 24;

const HOUR_MS = 3_600_000;

export type HoldInput = {
  quoteSentAt: Date | string | null;
  advancePaidAt: Date | string | null;
};

export type HoldState =
  /** Nothing quoted yet, so nothing is being held. */
  | { state: "none" }
  /** Quoted, unpaid, still inside the window. */
  | { state: "held"; expiresAt: Date; hoursLeft: number }
  /** Quoted, unpaid, window passed. The dates are free. */
  | { state: "released"; expiresAt: Date }
  /** The advance arrived. The hold no longer expires. */
  | { state: "paid"; paidAt: Date };

function asDate(value: Date | string | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** When a quote sent at this moment stops holding the dates. */
export function holdExpiryOf(quoteSentAt: Date): Date {
  return new Date(quoteSentAt.getTime() + HOLD_HOURS * HOUR_MS);
}

export function holdStateOf(input: HoldInput, now: Date): HoldState {
  const paidAt = asDate(input.advancePaidAt);

  // Payment wins over everything, including a quote that was never recorded
  // as sent. Money in hand is not undone by a missing timestamp.
  if (paidAt) return { state: "paid", paidAt };

  const sentAt = asDate(input.quoteSentAt);
  if (!sentAt) return { state: "none" };

  const expiresAt = holdExpiryOf(sentAt);

  if (now >= expiresAt) return { state: "released", expiresAt };

  return {
    state: "held",
    expiresAt,
    // Rounded up: with fifty minutes left, "1 hour" is the honest thing to
    // show an owner deciding whether to chase. Never reads as 0 while the
    // hold is genuinely still live.
    hoursLeft: Math.ceil((expiresAt.getTime() - now.getTime()) / HOUR_MS),
  };
}

/**
 * The deadline as a guest in India should read it: "13 Sep 2026, 5:30 pm".
 *
 * Written out in full rather than as "24 hours from now", because a message
 * is read whenever it is read. Someone opening this at breakfast should not
 * have to work out when it was sent to know how long they have.
 */
export function formatDeadline(when: Date): string {
  const date = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(when);

  const time = new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(when);

  return `${date}, ${time}`;
}
