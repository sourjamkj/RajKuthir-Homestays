import { datesTakenFor, type TakenEvent } from "./enquiry-clash.ts";
import { holdStateOf } from "./enquiry-hold.ts";

/**
 * "Your dates are free again": which open enquiries were told their nights
 * were taken, and which of them to tell now that the nights are free.
 *
 * Pure. The job (dates-freed.ts) loads the rows and does the sending.
 *
 * - An enquiry is remembered the first time its dates are seen taken.
 * - When they are free again it is told once, oldest enquiry first. Telling
 *   it holds the dates for 24 hours (the quote hold), so a later enquiry for
 *   the same nights waits; if the hold runs out unpaid, it is told next.
 * - Only future stays, and only enquiries from the last 60 days.
 */

export const DATES_AVAILABLE_TEMPLATE = "rk_dates_available";
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

export type FreedCandidate = {
  id: string;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  convertedBookingId: string | null;
  createdAt: Date | string;
  quoteSentAt: Date | string | null;
  advancePaidAt: Date | string | null;
};

export type WaitlistRow = { notifiedAt: Date | string | null };

export function freedDatesPlan(input: {
  enquiries: readonly FreedCandidate[];
  taken: readonly TakenEvent[];
  waitlist: ReadonlyMap<string, WaitlistRow>;
  today: string;
  now: Date;
}): { markTaken: string[]; notify: string[] } {
  const { now, today } = input;
  const open = input.enquiries
    .filter(
      (e) =>
        (e.status === "new" || e.status === "contacted") &&
        !e.convertedBookingId &&
        !!e.checkIn &&
        !!e.checkOut &&
        e.checkIn > today &&
        now.getTime() - new Date(e.createdAt).getTime() <= MAX_AGE_MS,
    )
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Another enquiry's live quote hold (or paid advance) keeps the nights taken.
  const holds = open
    .filter((e) => ["held", "paid"].includes(holdStateOf(e, now).state))
    .map((e) => ({ id: e.id, event: { source: "hold", startDate: e.checkIn!, endDate: e.checkOut!, title: null } }));

  const markTaken: string[] = [];
  const notify: string[] = [];
  const toldNow: TakenEvent[] = [];

  for (const e of open) {
    const others = [...input.taken, ...holds.filter((h) => h.id !== e.id).map((h) => h.event), ...toldNow];
    if (datesTakenFor(e, others)) {
      if (!input.waitlist.has(e.id)) markTaken.push(e.id);
      continue;
    }
    const waiting = input.waitlist.get(e.id);
    if (!waiting || waiting.notifiedAt) continue;
    // Already quoted and still held: they have their price; nothing to add.
    if (holdStateOf(e, now).state === "held") continue;
    notify.push(e.id);
    toldNow.push({ source: "hold", startDate: e.checkIn!, endDate: e.checkOut! });
  }

  return { markTaken, notify };
}
