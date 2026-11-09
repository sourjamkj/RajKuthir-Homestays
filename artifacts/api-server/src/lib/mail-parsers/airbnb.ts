import type { ParsedVoucher } from "./gomt.ts";

/**
 * Airbnb host emails.
 *
 * "Reservation confirmed - <Guest> arrives Nov 21" carries everything: the
 * confirmation code (HM…), check-in and checkout (month and day, no year),
 * the party ("4 adults, 1 child, 3 pets"), what the guest paid, Airbnb's host
 * service fee and the host payout ("YOU EARN"). A cancellation email names
 * the code and says canceled; it is saved as cancelled with whatever dates it
 * still shows.
 *
 * Airbnb never prints the year. It is the first year that puts the check-in
 * no more than 60 days in the past, from the moment the email is read.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function handlesSender(from: string): boolean {
  return /(^|[@.])airbnb\.(com|co\.in|co\.uk|ie|in)\b/i.test(from);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The year for a month/day with no year: never more than 60 days before `now`. */
export function inferYear(month: number, day: number, now: Date): string {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const year of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
    const at = Date.UTC(year, month - 1, day);
    if (at >= today - 60 * 86_400_000) return `${year}-${pad(month)}-${pad(day)}`;
  }
  return `${now.getUTCFullYear() + 1}-${pad(month)}-${pad(day)}`;
}

const rupeesAfter = (text: string, label: RegExp): number | null => {
  const match = text.match(new RegExp(label.source + String.raw`[^₹\d-]*-?\s*₹\s*([\d,]+(?:\.\d{1,2})?)`, "i"));
  if (!match) return null;
  return Math.round(Number(match[1]!.replace(/,/g, "")) * 100);
};

function datesOf(text: string, now: Date): { checkIn: string; checkOut: string } | null {
  // The two dates under "Check-in  Checkout": "Sat, Nov 21 Sun, Nov 22".
  const from = text.search(/check-?in/i);
  const slice = from >= 0 ? text.slice(from, from + 600) : text;
  const found = [...slice.matchAll(/\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+([a-z]{3})[a-z]*\s+(\d{1,2})\b/gi)];
  if (found.length < 2) return null;
  const [a, b] = found;
  const m1 = MONTHS[a![1]!.toLowerCase()];
  const m2 = MONTHS[b![1]!.toLowerCase()];
  if (!m1 || !m2) return null;
  const checkIn = inferYear(m1, Number(a![2]), now);
  let checkOut = inferYear(m2, Number(b![2]), now);
  // A stay over New Year: checkout's month is earlier than check-in's.
  if (checkOut <= checkIn) checkOut = `${Number(checkIn.slice(0, 4)) + 1}${checkOut.slice(4)}`;
  return { checkIn, checkOut };
}

function partyOf(text: string): { guests: number | null; pets: number | null } {
  const line = text.match(/guests\s*[:\n\r ]+\s*((?:\d+\s+(?:adults?|child(?:ren)?|infants?|pets?),?\s*)+)/i)?.[1] ?? "";
  const count = (word: RegExp) => Number(line.match(new RegExp(String.raw`(\d+)\s+` + word.source, "i"))?.[1] ?? 0);
  const adults = count(/adults?/);
  const children = count(/child(?:ren)?/);
  const pets = count(/pets?/);
  if (!line) return { guests: null, pets: null };
  return { guests: adults + children || null, pets };
}

export function parseAirbnbEmail(subject: string, from: string, body: string, now = new Date()): ParsedVoucher | null {
  if (!handlesSender(from)) return null;
  const text = body.replace(/ /g, " ");
  const code = (text.match(/confirmation\s+code\s*[:\n\r ]+\s*(HM[A-Z0-9]{6,12})\b/i) ?? subject.match(/\b(HM[A-Z0-9]{6,12})\b/))?.[1];
  if (!code) return null;

  const cancelled = /cancel(l)?ed/i.test(subject) || /reservation\s+(?:has been\s+)?cancel(l)?ed/i.test(text.slice(0, 600));
  const confirmed = /reservation confirmed|new booking confirmed/i.test(subject + " " + text.slice(0, 400));
  if (!cancelled && !confirmed) return null;

  const dates = datesOf(text, now);
  if (!dates) return null;
  const party = partyOf(text);
  const guestName =
    subject.match(/reservation confirmed\s*[-–—:]\s*(.+?)\s+arrives\b/i)?.[1]?.trim().slice(0, 120) ?? null;

  const gross = rupeesAfter(text, /total\s*\(inr\)/);
  const fee = rupeesAfter(text, /host service fee(?:\s*\([\d.]+%\))?/);
  const earn = rupeesAfter(text, /you earn/);

  return {
    externalRef: code.toUpperCase(),
    source: "airbnb",
    status: cancelled ? "cancelled" : "confirmed",
    guestName,
    checkIn: dates.checkIn,
    checkOut: dates.checkOut,
    guests: party.guests,
    pets: party.pets,
    grossPaise: cancelled ? null : gross,
    commissionPaise: cancelled ? null : fee,
    taxPaise: null,
    receivedPaise: cancelled ? null : earn,
    sourceSubject: subject.slice(0, 200),
  };
}
