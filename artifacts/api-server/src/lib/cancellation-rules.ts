/**
 * The cancellation & refund policy, as arithmetic. The words on
 * /cancellation-refund-policy and these numbers must say the same thing;
 * cancellation-rules.test.ts pins both.
 *
 * Regular dates (advance paid at booking):
 *   15+ days before check-in  → advance back, less ₹200 processing
 *   7–14 days                 → half the advance back, or all of it as credit
 *   under 7 days / no-show    → nothing back
 * Peak dates (paid in full at booking):
 *   30+ days                  → 90% back
 *   under 30 days             → nothing back
 * Credit for a later stay, and a refund if the nights are rebooked, are the
 * owner's to offer on top; this only says what the policy guarantees.
 *
 * Days are counted in IST calendar days from the cancellation date to the
 * check-in date. Any card / net banking convenience fee is excluded before
 * this is called: it is never refundable.
 */

export const PROCESSING_FEE_PAISE = 20_000;
export const REGULAR_FULL_DAYS = 15;
export const REGULAR_PARTIAL_DAYS = 7;
export const PEAK_REFUND_DAYS = 30;
export const PEAK_REFUND_PERCENT = 90;

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

/** The IST calendar date of an instant, as YYYY-MM-DD. */
export function istDate(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whole days from one ISO date to another (negative once check-in has passed). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
}

export type CancellationRefund = {
  daysBefore: number;
  peak: boolean;
  /** Refund the policy guarantees, in paise. */
  refundPaise: number;
  /** Credit for a later stay the guest may take instead (7–14 days, regular dates), or 0. */
  creditPaise: number;
  /** One line for the owner, e.g. "18 days before check-in: advance less ₹200". */
  rule: string;
};

export function cancellationRefund(input: {
  checkIn: string;
  cancelledAt: Date;
  /** What the guest paid towards the stay, convenience fee already excluded. */
  paidPaise: number;
  peak: boolean;
}): CancellationRefund {
  const paid = Math.max(0, Math.round(input.paidPaise));
  const daysBefore = daysBetween(istDate(input.cancelledAt), input.checkIn);
  const days = `${daysBefore} day${daysBefore === 1 ? "" : "s"} before check-in`;

  if (input.peak) {
    if (daysBefore >= PEAK_REFUND_DAYS) {
      const refundPaise = Math.floor((paid * PEAK_REFUND_PERCENT) / 100 / 100) * 100;
      return { daysBefore, peak: true, refundPaise, creditPaise: 0, rule: `Peak dates, ${days}: ${PEAK_REFUND_PERCENT}% back` };
    }
    return { daysBefore, peak: true, refundPaise: 0, creditPaise: 0, rule: `Peak dates, ${days}: no refund` };
  }

  if (daysBefore >= REGULAR_FULL_DAYS) {
    return {
      daysBefore,
      peak: false,
      refundPaise: Math.max(0, paid - PROCESSING_FEE_PAISE),
      creditPaise: 0,
      rule: `${days}: advance back less ₹200 processing`,
    };
  }
  if (daysBefore >= REGULAR_PARTIAL_DAYS) {
    return {
      daysBefore,
      peak: false,
      refundPaise: Math.floor(paid / 2 / 100) * 100,
      creditPaise: paid,
      rule: `${days}: half the advance back, or all of it as credit`,
    };
  }
  return { daysBefore, peak: false, refundPaise: 0, creditPaise: 0, rule: `${days}: no refund` };
}
