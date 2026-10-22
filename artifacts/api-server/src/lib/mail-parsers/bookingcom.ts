import type { ParsedVoucher } from "./gomt.ts";

/**
 * Parser for Booking.com's emails to the property.
 *
 * Booking.com never puts the whole reservation in one email. What it sends:
 *
 *   "Booking.com - New booking! (6429184451, Friday, 23 October 2026)"
 *   "Booking.com - Modified booking! (…)" / "… Cancelled booking! (…)"
 *       Subject line only: the reservation number and the CHECK-IN date.
 *       The body is a link to the extranet. No check-out, no guest name.
 *
 *   "AYUSH DHAR's request has been confirmed"
 *   "We received this message from Ghosh Sanchita"
 *       Guest messages and auto-replies. These carry a full "Reservation
 *       details" block: guest name, check-in, check-out, booking number,
 *       total guests.
 *
 * So there are two kinds of voucher here, and the save step treats them
 * differently (see mail-runner.ts):
 *
 *   kind "notice"  — from the subject. Trusted for the reservation number,
 *                    the check-in and the status. The check-out is NOT known;
 *                    it is filled from the Booking.com calendar feed when that
 *                    has the stay, and otherwise assumed to be one night until
 *                    a details email or the feed corrects it.
 *   kind "details" — from the Reservation details block. Trusted for dates,
 *                    name and party size, but says nothing about status: a
 *                    guest can message after cancelling, and that must not
 *                    bring the booking back to life.
 *
 * No money anywhere: Booking.com emails do not include the price.
 */

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** noreply@booking.com, 123-abc@guest.booking.com, …@property.booking.com. */
export function handlesSender(from: string): boolean {
  return /(^|[@.])booking\.com\b/i.test(from);
}

function flatten(body: string): string {
  return body.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** "23", "October" | "Oct", "2026" -> "2026-10-23". */
function toIso(day: string, month: string, year: string): string | null {
  const mm = MONTHS[month.toLowerCase().slice(0, 3)];
  const dd = Number(day);
  if (!mm || !Number.isInteger(dd) || dd < 1 || dd > 31 || !/^\d{4}$/.test(year)) return null;
  return `${year}-${mm}-${String(dd).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number): string {
  const at = new Date(`${iso}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

const SUBJECT =
  /\b(New|Modified|Cancelled|Canceled) booking!?\s*\(\s*(\d{6,12})\s*,\s*[A-Za-z]+,?\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*\)/i;

export function parseBookingComEmail(
  subject: string,
  from: string,
  body: string,
): ParsedVoucher | null {
  if (!handlesSender(from)) return null;

  const notice = SUBJECT.exec(subject);
  if (notice) {
    const checkIn = toIso(notice[3]!, notice[4]!, notice[5]!);
    if (!checkIn) return null;
    const cancelled = /^cancel/i.test(notice[1]!);
    return {
      externalRef: notice[2]!,
      source: "bookingCom",
      kind: "notice",
      status: cancelled ? "cancelled" : "confirmed",
      guestName: null,
      checkIn,
      // Placeholder only — mail-runner prefers the calendar feed, then keeps
      // any check-out already on file, before it ever uses this.
      checkOut: addDays(checkIn, 1),
      guests: null,
      grossPaise: null,
      commissionPaise: null,
      taxPaise: null,
      receivedPaise: null,
      sourceSubject: subject.slice(0, 200),
    };
  }

  const flat = flatten(body);
  if (!/Reservation details/i.test(flat)) return null;

  const ref =
    /Booking number:?\s*(\d{6,12})\b/i.exec(flat)?.[1] ??
    /Confirmation number:?\s*(\d{6,12})\b/i.exec(flat)?.[1] ??
    null;
  const dateAfter = (label: string) => {
    const match = new RegExp(
      `${label}:?\\s*(?:[A-Za-z]{3,9},?\\s+)?(\\d{1,2})\\s+([A-Za-z]{3,9})\\s+(\\d{4})`,
      "i",
    ).exec(flat);
    return match ? toIso(match[1]!, match[2]!, match[3]!) : null;
  };
  const checkIn = dateAfter("Check-in");
  const checkOut = dateAfter("Check-out");

  if (!ref || !checkIn || !checkOut || checkOut <= checkIn) return null;

  const rawName = /Guest name:?\s*(.+?)\s+Check-in\b/i.exec(flat)?.[1]?.trim() ?? "";
  const guestName = /^[\p{L}][\p{L} .'-]{0,79}$/u.test(rawName) ? titleCase(rawName) : null;
  const guests = Number(/Total guests:?\s*(\d{1,2})\b/i.exec(flat)?.[1] ?? "");

  return {
    externalRef: ref,
    source: "bookingCom",
    kind: "details",
    status: "confirmed",
    guestName,
    checkIn,
    checkOut,
    guests: Number.isInteger(guests) && guests > 0 ? guests : null,
    grossPaise: null,
    commissionPaise: null,
    taxPaise: null,
    receivedPaise: null,
    sourceSubject: subject.slice(0, 200),
  };
}

/** "AYUSH DHAR" -> "Ayush Dhar"; already mixed-case names are left alone. */
function titleCase(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Marks a booking whose check-out came from a guess, so the feed can fix it. */
export const ASSUMED_CHECKOUT_NOTE =
  "Check-out assumed (1 night) from the Booking.com notice email; corrected automatically from the calendar feed or a guest message.";

/**
 * The check-out to store for a subject-only notice.
 *
 * 1. The Booking.com calendar feed, when it already has a stay starting that
 *    day — that is Booking.com's own answer.
 * 2. Otherwise whatever is already on file, if it is still after the check-in
 *    (a details email may have set it).
 * 3. Otherwise one night, flagged as assumed.
 */
export function resolveNoticeCheckOut(input: {
  checkIn: string;
  calendarEnd: string | null;
  existingCheckOut: string | null;
}): { checkOut: string; assumed: boolean } {
  if (input.calendarEnd && input.calendarEnd > input.checkIn) {
    return { checkOut: input.calendarEnd, assumed: false };
  }
  if (input.existingCheckOut && input.existingCheckOut > input.checkIn) {
    return { checkOut: input.existingCheckOut, assumed: false };
  }
  return { checkOut: addDays(input.checkIn, 1), assumed: true };
}
