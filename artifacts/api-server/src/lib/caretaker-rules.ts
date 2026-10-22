/**
 * Caretaker alerts: what to send, to whom, and when. No database, no clock of
 * its own, no network — caretaker-alerts.ts does those and calls this.
 *
 *   new_booking   as soon as a booking appears (never 9 pm – 8 am IST)
 *   checkin_eve   10 am IST the day before check-in
 *   checkout_eve  10 am IST the day before check-out
 *   cancelled     when a booking the caretaker was told about is cancelled
 *
 * Every alert goes to the caretaker and to the owner. Each (booking, kind,
 * recipient) is sent at most once; caretaker-alerts.ts records it.
 */

export type AlertKind = "new_booking" | "checkin_eve" | "checkout_eve" | "cancelled";

export type AlertBooking = {
  id: string;
  source: string;
  status: "pending" | "confirmed" | "cancelled";
  guestName: string | null;
  guestPhone: string | null;
  checkIn: string;
  checkOut: string;
  guests: number | null;
  pets: number | null;
  grossPaise: number | null;
  receivedPaise: number | null;
  createdAt: Date;
};

export type DueAlert = { bookingId: string; kind: AlertKind; text: string };

const IST_MS = 330 * 60_000;
const HOUR = 3_600_000;
const QUIET_START = 21;
const QUIET_END = 8;
const EVE_HOUR = 10;

/** The UTC instant of hh:00 IST on an ISO date. */
export function istAt(isoDate: string, hour: number): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, hour) - IST_MS);
}

export function istDate(at: Date): string {
  return new Date(at.getTime() + IST_MS).toISOString().slice(0, 10);
}

function istHour(at: Date): number {
  return new Date(at.getTime() + IST_MS).getUTCHours();
}

function addDays(iso: string, days: number): string {
  const at = new Date(`${iso}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export function isQuietHour(at: Date): boolean {
  const hour = istHour(at);
  return hour >= QUIET_START || hour < QUIET_END;
}

const SOURCE_LABEL: Record<string, string> = {
  direct: "Direct (website)",
  manual: "Offline",
  bookingCom: "Booking.com",
  airbnb: "Airbnb",
  makeMyTrip: "MakeMyTrip / Goibibo",
};

function day(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y!, m! - 1, d!)),
  );
}

function rupees(paise: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(paise / 100));
}

function nights(b: AlertBooking): number {
  return Math.max(1, Math.round((Date.parse(b.checkOut) - Date.parse(b.checkIn)) / 86_400_000));
}

/** What is still to collect at the property, when the total is known. */
export function balancePaise(b: AlertBooking): number | null {
  if (b.grossPaise === null) return null;
  return Math.max(0, b.grossPaise - (b.receivedPaise ?? 0));
}

/** Channels where the guest pays the OTA, so nothing is collected on site. */
const PREPAID = new Set(["airbnb", "makeMyTrip"]);

/**
 * Payment as the caretaker sees it: "Paid" or "Due", never an amount. The
 * owner keeps the figures; the caretaker only needs to know whether to ask.
 */
export function paymentStatus(b: AlertBooking): "Paid" | "Due" {
  if (PREPAID.has(b.source)) return "Paid";
  const balance = balancePaise(b);
  return balance === 0 ? "Paid" : "Due";
}

function lines(b: AlertBooking, extra: string[] = []): string {
  const pets = b.pets && b.pets > 0 ? `Yes, ${b.pets}` : "No";
  return [
    `• Guest: ${b.guestName ?? "Name not known yet"}${b.guests ? ` (${b.guests} guest${b.guests === 1 ? "" : "s"})` : ""}`,
    `• Pets: ${pets}`,
    `• Check-in: ${day(b.checkIn)}, from 12 noon`,
    `• Check-out: ${day(b.checkOut)}, by 11 am (${nights(b)} night${nights(b) === 1 ? "" : "s"})`,
    `• Booked via: ${SOURCE_LABEL[b.source] ?? b.source}`,
    b.guestPhone ? `• Guest phone: ${b.guestPhone}` : null,
    `• Payment: ${paymentStatus(b)}`,
    ...extra,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function alertText(kind: AlertKind, b: AlertBooking): string {
  switch (kind) {
    case "new_booking":
      return `Raj Kuthir – Sobuj Potro: NEW BOOKING\n${lines(b)}`;
    case "checkin_eve":
      return `Raj Kuthir – Sobuj Potro: guest ARRIVES TOMORROW\n${lines(b, [
        "• Please get the villa ready today: cleaning, fresh linen and towels, drinking water, AC and Wi-Fi working.",
      ])}`;
    case "checkout_eve":
      return `Raj Kuthir – Sobuj Potro: guest CHECKS OUT TOMORROW\n${lines(b, [
        "• Check-out by 11 am. Please check the rooms, collect the keys, and report any damage.",
      ])}`;
    case "cancelled":
      return `Raj Kuthir – Sobuj Potro: booking CANCELLED\n• Guest: ${b.guestName ?? "Name not known"}\n• Was: ${day(b.checkIn)} to ${day(b.checkOut)} (${SOURCE_LABEL[b.source] ?? b.source})\n• No need to prepare for these dates.`;
  }
}

/**
 * Which alerts are due right now and have not been sent.
 *
 * `sent` holds "bookingId:kind" for alerts already delivered to everyone.
 * Rules that keep this quiet rather than noisy:
 *  - nothing during quiet hours; it goes at 8 am instead
 *  - a "new booking" only for a booking created in the last 24 hours that
 *    has not ended — a bulk import of old bookings must not page anyone
 *  - an eve reminder only between 10 am the day before and the moment
 *    itself (check-in noon / check-out 11 am), so a late run never sends a
 *    reminder for something already happening
 *  - no check-in reminder for a booking made after its 10 am slot: the
 *    new-booking alert just told them
 *  - "cancelled" only if the caretaker was told about the booking
 */
export function dueAlerts(
  bookings: AlertBooking[],
  sent: ReadonlySet<string>,
  now: Date,
  options: { manual?: boolean } = {},
): DueAlert[] {
  // Manual mode is the owner's own queue in the console: no quiet hours (they
  // choose when to tap send) and a new booking stays listed for a week, not a
  // day, in case the console is not opened for a while.
  const manual = options.manual === true;
  if (!manual && isQuietHour(now)) return [];
  const newWindow = (manual ? 7 * 24 : 24) * HOUR;
  const today = istDate(now);
  const due: DueAlert[] = [];
  const push = (b: AlertBooking, kind: AlertKind) => {
    if (!sent.has(`${b.id}:${kind}`)) due.push({ bookingId: b.id, kind, text: alertText(kind, b) });
  };

  for (const b of bookings) {
    if (b.status === "cancelled") {
      const told = sent.has(`${b.id}:new_booking`) || sent.has(`${b.id}:checkin_eve`);
      if (told && b.checkOut > today) push(b, "cancelled");
      continue;
    }
    if (b.status !== "confirmed") continue;

    if (now.getTime() - b.createdAt.getTime() < newWindow && b.checkOut > today) {
      push(b, "new_booking");
    }

    const checkinEve = istAt(addDays(b.checkIn, -1), EVE_HOUR);
    const checkinAt = istAt(b.checkIn, 12);
    if (now >= checkinEve && now < checkinAt && b.createdAt < checkinEve) {
      push(b, "checkin_eve");
    }

    const checkoutEve = istAt(addDays(b.checkOut, -1), EVE_HOUR);
    const checkoutAt = istAt(b.checkOut, 11);
    if (now >= checkoutEve && now < checkoutAt) {
      push(b, "checkout_eve");
    }
  }

  return due;
}

/** "+91 78726 85558" / "7872685558" -> "+917872685558", or null. */
export function toE164(raw: string | null | undefined): string | null {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? `+${digits}` : null;
}
