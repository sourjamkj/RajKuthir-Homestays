/**
 * One guest, one stay, one booking.
 *
 * Pure rules for the three places a stay can be duplicated or left hanging:
 *
 *   - converting an enquiry (the owner's "Booked", or Book & Pay's Confirm):
 *     no booking without a received advance, and never a second booking for
 *     the same guest over the same nights;
 *   - starting Book & Pay again: the same guest coming back to the same
 *     dates RESUMES their hold instead of starting a second one, and a guest
 *     who changes dates releases their own earlier unpaid hold;
 *   - the sweep: an unpaid ("pending") booking is released back to an
 *     enquiry once its hold time has passed, and an exact duplicate of a
 *     stay is merged into the one that survives.
 *
 * No database here; booking-dedupe.ts and the routes do the I/O.
 */

/** Last ten digits: +91 98300 40042, 09830040042 and 9830040042 are one number. */
export function phoneKey(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

export function nameKey(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().normalize("NFKD").replace(/[^\p{L}]+/gu, " ").trim();
}

/** Same mobile number, or — when either has none — exactly the same name. */
export function samePerson(
  a: { phone: string | null; name: string | null },
  b: { phone: string | null; name: string | null },
): boolean {
  const pa = phoneKey(a.phone);
  const pb = phoneKey(b.phone);
  if (pa && pb) return pa === pb;
  const na = nameKey(a.name);
  return na !== "" && na === nameKey(b.name);
}

/** Half-open, as everywhere: a stay ending on the 5th does not overlap one starting then. */
export function overlaps(a: { checkIn: string; checkOut: string }, b: { checkIn: string; checkOut: string }): boolean {
  return a.checkIn < b.checkOut && a.checkOut > b.checkIn;
}

export type BookingLite = {
  id: string;
  reference: string | null;
  status: "pending" | "confirmed" | "cancelled";
  source: string;
  guestName: string | null;
  guestPhone: string | null;
  checkIn: string;
  checkOut: string;
  receivedPaise: number | null;
  createdAt: Date;
  /** Has the guest's pre-arrival / documents on it. */
  hasOnboarding?: boolean;
};

/* --------------------------- converting an enquiry --------------------------- */

export type ConversionPlan =
  | { kind: "refuse_unpaid" }
  /** This guest already holds a confirmed booking for these nights: link to it, create nothing. */
  | { kind: "link"; booking: BookingLite }
  /** Create the booking, after releasing this guest's own unpaid bookings on these nights. */
  | { kind: "create"; release: BookingLite[] };

export function planConversion(input: {
  paid: boolean;
  stay: { name: string | null; phone: string | null; checkIn: string; checkOut: string };
  existing: BookingLite[];
}): ConversionPlan {
  if (!input.paid) return { kind: "refuse_unpaid" };

  const mine = input.existing.filter(
    (booking) =>
      booking.status !== "cancelled" &&
      overlaps(booking, input.stay) &&
      samePerson({ phone: booking.guestPhone, name: booking.guestName }, input.stay),
  );

  const confirmed = mine.find((booking) => booking.status === "confirmed");
  if (confirmed) return { kind: "link", booking: confirmed };

  return { kind: "create", release: mine.filter((booking) => booking.status === "pending") };
}

export const UNPAID_MESSAGE =
  "Mark the advance as received first. Until it is paid this stays an enquiry, and its dates are released when the hold ends.";

/* ----------------------------- starting Book & Pay ----------------------------- */

export type OwnHold = {
  paymentRequestId: string;
  enquiryId: string;
  reference: string;
  status: "awaiting_payment" | "submitted";
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  pets: number;
  holdExpiresAt: Date;
  totalPaise: number;
  advancePaise: number;
};

export type StartPlan =
  /** Same guest, same dates, same party: hand back the hold they already have. */
  | { kind: "resume"; hold: OwnHold }
  /** A fresh hold, after releasing this guest's own unpaid holds. */
  | { kind: "new"; release: OwnHold[] };

/**
 * `own` is the guest's LIVE holds only (still inside their time). A hold with
 * a UTR submitted is never released here — the owner is checking that money —
 * but it is resumed if the guest comes back to the same stay.
 */
export function planStart(
  own: OwnHold[],
  input: { checkIn: string; checkOut: string; adults: number; children: number; pets: number },
): StartPlan {
  const same = own.find(
    (hold) =>
      hold.checkIn === input.checkIn &&
      hold.checkOut === input.checkOut &&
      hold.adults === input.adults &&
      hold.children === input.children &&
      hold.pets === input.pets,
  );
  if (same) return { kind: "resume", hold: same };
  return { kind: "new", release: own.filter((hold) => hold.status === "awaiting_payment") };
}

/* ---------------------------------- the sweep ---------------------------------- */

/** OTA bookings are paid to the channel; only our own can be "unpaid". */
const OWN_SOURCES = new Set(["direct", "manual"]);

/**
 * Pending (unpaid) bookings of our own whose hold has run out: released back
 * to enquiries. A booking with any money received is never released.
 */
export function unpaidToRelease(rows: BookingLite[], now: Date, holdHours: number): BookingLite[] {
  const cutoff = now.getTime() - holdHours * 3_600_000;
  return rows.filter(
    (booking) =>
      booking.status === "pending" &&
      OWN_SOURCES.has(booking.source) &&
      !(booking.receivedPaise && booking.receivedPaise > 0) &&
      booking.createdAt.getTime() <= cutoff,
  );
}

/** Which of two copies of a stay to keep: confirmed, then onboarding, then paid, then oldest. */
function rank(booking: BookingLite): [number, number, number, number] {
  return [
    booking.status === "confirmed" ? 0 : 1,
    booking.hasOnboarding ? 0 : 1,
    -(booking.receivedPaise ?? 0),
    booking.createdAt.getTime(),
  ];
}

function compare(a: BookingLite, b: BookingLite): number {
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < ra.length; i += 1) {
    if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
  }
  return a.id.localeCompare(b.id);
}

export function pickSurvivor(copies: BookingLite[]): BookingLite {
  return [...copies].sort(compare)[0]!;
}

/**
 * Exact duplicates: our own bookings (not OTA, not cancelled) with the same
 * guest number and the same dates. Anything looser — overlapping but not
 * identical dates, or no phone — is left for the owner: it could be two
 * real stays.
 */
export function duplicateGroups(rows: BookingLite[]): Array<{ survivor: BookingLite; duplicates: BookingLite[] }> {
  const groups = new Map<string, BookingLite[]>();
  for (const booking of rows) {
    if (booking.status === "cancelled" || !OWN_SOURCES.has(booking.source)) continue;
    const phone = phoneKey(booking.guestPhone);
    if (!phone) continue;
    const key = `${phone}|${booking.checkIn}|${booking.checkOut}`;
    groups.set(key, [...(groups.get(key) ?? []), booking]);
  }
  const out: Array<{ survivor: BookingLite; duplicates: BookingLite[] }> = [];
  for (const copies of groups.values()) {
    if (copies.length < 2) continue;
    const survivor = pickSurvivor(copies);
    out.push({ survivor, duplicates: copies.filter((copy) => copy.id !== survivor.id) });
  }
  return out;
}

/**
 * For a booking the owner named as a duplicate: the stay it duplicates — the
 * same guest over overlapping nights, not cancelled. Null means there is no
 * other copy, so deleting it would delete the stay itself.
 */
export function survivorFor(duplicate: BookingLite, rows: BookingLite[]): BookingLite | null {
  const others = rows.filter(
    (booking) =>
      booking.id !== duplicate.id &&
      booking.status !== "cancelled" &&
      overlaps(booking, duplicate) &&
      samePerson({ phone: booking.guestPhone, name: booking.guestName }, { phone: duplicate.guestPhone, name: duplicate.guestName }),
  );
  return others.length ? pickSurvivor(others) : null;
}
