/**
 * One month of the calendar, day by day, for the owner's phone: who is in,
 * what is closed, what is held for payment, and what an empty night costs.
 * Pure; the route gathers the inputs.
 *
 * A night belongs to the date it starts on (check-in day to the night before
 * check-out), like every range in this codebase: [startDate, endDate).
 */

export type MonthEvent = {
  id: string;
  source: string;
  startDate: string;
  endDate: string;
  title: string | null;
  origin: "event" | "booking";
};

export type MonthHold = { id: string; startDate: string; endDate: string };
export type MonthPeak = { label: string; startDate: string; endDate: string; minNights: number };

export type DayStatus = "past" | "free" | "booked" | "blocked" | "held";

export type MonthDay = {
  date: string;
  /** 0 = Sunday. */
  weekday: number;
  status: DayStatus;
  /** Where the night came from: direct, bookingCom, airbnb, makeMyTrip, manual, hold. */
  source: string | null;
  /** Guest name or the OTA's own label, never an amount. */
  label: string | null;
  /** A stay starts this day / the previous night's stay leaves this morning. */
  checkIn: boolean;
  checkOut: boolean;
  /** What this night costs for two guests, in paise. Free future nights only. */
  pricePaise: number | null;
  peak: string | null;
  minNights: number | null;
};

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseMonth(value: unknown, today: string): string {
  return typeof value === "string" && MONTH.test(value) ? value : today.slice(0, 7);
}

export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const count = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** An owner or OTA block rather than a guest (same rule as the web console's isBlock). */
export function isBlockEvent(event: Pick<MonthEvent, "source" | "title">): boolean {
  if (event.source === "manual") return true;
  return /not available|unavailable|blocked|closed/i.test(event.title ?? "");
}

/** "Booked — Ananya Sen" → "Ananya Sen"; OTA "Reserved" stays as is. */
function guestLabel(event: MonthEvent): string | null {
  const title = event.title?.trim() ?? "";
  const named = /^booked\s*[—–-]\s*(.+)$/i.exec(title);
  return named ? named[1]!.trim() : title || null;
}

export function buildMonth(input: {
  month: string;
  today: string;
  events: MonthEvent[];
  holds: MonthHold[];
  peaks: MonthPeak[];
  priceFor: (isoDate: string) => number | null;
}) {
  const days: MonthDay[] = daysOfMonth(input.month).map((date) => {
    const night = input.events.find((e) => e.startDate <= date && date < e.endDate);
    const hold = night ? null : input.holds.find((h) => h.startDate <= date && date < h.endDate);
    const leaving = input.events.some((e) => e.endDate === date && !isBlockEvent(e));
    const peak = input.peaks.find((p) => p.startDate <= date && date < p.endDate) ?? null;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();

    let status: DayStatus = "free";
    let source: string | null = null;
    let label: string | null = null;
    let checkIn = false;
    if (night) {
      status = isBlockEvent(night) ? "blocked" : "booked";
      source = night.source;
      label = status === "booked" ? guestLabel(night) : night.title?.trim() || "Closed";
      checkIn = status === "booked" && night.startDate === date;
    } else if (hold) {
      status = "held";
      source = "hold";
      label = "Payment pending";
      checkIn = hold.startDate === date;
    }
    if (date < input.today && status === "free") status = "past";

    return {
      date,
      weekday,
      status,
      source,
      label,
      checkIn,
      checkOut: leaving,
      pricePaise: status === "free" ? input.priceFor(date) : null,
      peak: peak?.label ?? null,
      minNights: peak?.minNights ?? null,
    };
  });

  const future = days.filter((d) => d.date >= input.today);
  const count = (s: DayStatus) => days.filter((d) => d.status === s).length;
  const sellable = future.filter((d) => d.status !== "blocked").length;
  const bookedAhead = future.filter((d) => d.status === "booked" || d.status === "held").length;

  return {
    month: input.month,
    previous: shiftMonth(input.month, -1),
    next: shiftMonth(input.month, 1),
    today: input.today,
    days,
    summary: {
      bookedNights: count("booked"),
      heldNights: count("held"),
      blockedNights: count("blocked"),
      freeNights: count("free"),
      /** Of the nights still to come this month that could be sold, the share already taken. */
      occupancyAheadPercent: sellable ? Math.round((bookedAhead / sellable) * 100) : null,
    },
  };
}
