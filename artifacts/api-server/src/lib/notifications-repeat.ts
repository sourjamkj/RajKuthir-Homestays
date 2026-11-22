import { addDays, istDateOf, istMoment } from "./review-rules.ts";

/**
 * When a repeating guest message goes out again, or null when it is done.
 *  - ID reminder: every 24 hours, the last one on the day before check-in.
 *    (Verification stops it sooner: the send is cancelled once verified.)
 *  - Review request: one reminder at 6 pm the day after check-out, and only
 *    after an ask sent on check-out day.
 */
export function nextRepeat(kind: "verification_reminder" | "review_request", checkIn: string, checkOut: string, now: Date): Date | null {
  if (kind === "verification_reminder") {
    const next = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return istDateOf(next) <= addDays(checkIn, -1) ? next : null;
  }
  const reminder = istMoment(addDays(checkOut, 1), 18);
  return now.getTime() < reminder.getTime() - 12 * 60 * 60 * 1000 ? reminder : null;
}
