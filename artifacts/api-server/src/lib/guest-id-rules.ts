/**
 * One ID per guest, grouped by guest.
 *
 * The pre-arrival page shows one card per guest on the booking. Each card
 * names the guest, says adult or child, picks an ID type, and fills exactly
 * the photo slots that type needs (Aadhaar: front and back; passport: the
 * photo page, plus the visa for a foreign national). Submit is refused until
 * every guest the booking covers has a complete card — on the phone first,
 * and here again, so it cannot be bypassed.
 *
 * Every guest uploads an ID, children included (the owner's rule). Children
 * may use a school ID or a birth certificate as well as Aadhaar or passport.
 *
 * A guest party can grow: the guest may add cards beyond the booked count.
 * That is allowed (up to MAX_EXTRA_GUESTS more, within MAX_PARTY) and the
 * owner is told, with the extra charge the rates imply.
 *
 * Pure: no imports with side effects, so the page, the console and the tests
 * can all lean on it.
 */

export type GuestAge = "adult" | "child";

export type IdTypeKey = "aadhaar" | "passport" | "dl" | "voter" | "school" | "birth";

export const ID_TYPES: Record<IdTypeKey, { label: string; sides: string[]; adult: boolean; child: boolean }> = {
  aadhaar: { label: "Aadhaar", sides: ["Front", "Back"], adult: true, child: true },
  passport: { label: "Passport", sides: ["Photo page"], adult: true, child: true },
  dl: { label: "Driving licence", sides: ["Front", "Back"], adult: true, child: false },
  voter: { label: "Voter ID", sides: ["Front", "Back"], adult: true, child: false },
  school: { label: "School ID", sides: ["Front"], adult: false, child: true },
  birth: { label: "Birth certificate", sides: ["Certificate"], adult: false, child: true },
};

export const VISA_SIDE = "Indian visa";
export const MAX_PARTY = 8;
/** Top of the rate ladder (pricing.ts LADDER_MAX_GUESTS); above it the extra-adult rate applies. */
export const RATE_LADDER_MAX = 5;
export const MAX_EXTRA_GUESTS = 3;
/** Front + back per guest, plus a visa, for the largest party. */
export const MAX_FILES_PER_SUBMIT = MAX_PARTY * 3;

export function isIdType(value: unknown): value is IdTypeKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ID_TYPES, value);
}

export function requiredSides(idType: IdTypeKey, foreign: boolean): string[] {
  const sides = [...ID_TYPES[idType].sides];
  if (foreign && idType === "passport") sides.push(VISA_SIDE);
  return sides;
}

/** Most cards a guest may fill: the booked count plus a few, never above MAX_PARTY. */
export function maxCards(booked: number): number {
  return Math.min(MAX_PARTY, Math.max(1, booked) + MAX_EXTRA_GUESTS);
}

export type SlotFile = { side: string };
export type GuestSlotInput = {
  slot: number;
  name: string;
  age: GuestAge;
  idType: string;
  foreign: boolean;
  files: SlotFile[];
};

/**
 * Null when this submission, together with the guests already accepted
 * (`keptSlots`), covers the booking with a complete ID for each guest;
 * otherwise one sentence the guest can act on.
 */
export function partyProblem(input: { booked: number; keptSlots: number[]; slots: GuestSlotInput[] }): string | null {
  const booked = Math.max(1, input.booked || 1);
  const limit = maxCards(booked);
  const seen = new Set<number>(input.keptSlots);

  for (const slot of input.slots) {
    const label = `Guest ${slot.slot}`;
    if (!Number.isInteger(slot.slot) || slot.slot < 1 || slot.slot > limit) return `${label} is not a guest on this booking.`;
    if (seen.has(slot.slot)) return `${label} appears twice. Each guest needs one card.`;
    seen.add(slot.slot);
    if (!slot.name.trim()) return `Enter the full name for ${label}.`;
    if (slot.age !== "adult" && slot.age !== "child") return `Say whether ${label} is an adult or a child.`;
    if (!isIdType(slot.idType)) return `Choose an ID type for ${label}.`;
    const type = ID_TYPES[slot.idType];
    if (slot.age === "child" ? !type.child : !type.adult) {
      return `${type.label} is not accepted for ${slot.age === "child" ? "a child" : "an adult"} (${label}).`;
    }
    const need = requiredSides(slot.idType, slot.foreign);
    const have = slot.files.map((f) => f.side);
    for (const side of need) {
      const count = have.filter((s) => s === side).length;
      if (count === 0) return `Add the ${side.toLowerCase()} of ${slot.name.trim()}'s ${type.label}.`;
      if (count > 1) return `Only one ${side.toLowerCase()} per guest, please (${label}).`;
    }
    const extra = have.find((s) => !need.includes(s));
    if (extra) return `${label}: "${extra}" is not part of a ${type.label}.`;
  }

  for (let n = 1; n <= booked; n += 1) {
    if (!seen.has(n)) return `Your booking is for ${booked} guest${booked === 1 ? "" : "s"}. Add an ID for Guest ${n}.`;
  }
  return null;
}

/** How the extra charge is worked out, sent to the page with the booking. */
export type ExtraGuestRates = {
  includedGuests: number;
  ladderPaise: number;
  ladderMax: number;
  abovePaise: number;
};

/**
 * Extra charge per night for guests listed beyond the booked count: the rate
 * ladder's per-guest step up to the ladder's top, the extra-adult rate above
 * it. Guests within the ladder's included count cost nothing extra.
 */
export function extraGuestPerNightPaise(booked: number, listed: number, rates: ExtraGuestRates): number {
  let total = 0;
  for (let n = Math.max(1, booked) + 1; n <= listed; n += 1) {
    if (n <= rates.includedGuests) continue;
    total += n <= rates.ladderMax ? rates.ladderPaise : rates.abovePaise;
  }
  return total;
}

/** "Guest 2 · Aadhaar · Front – Riya Sen", the label stored as the document type. */
export function documentLabel(slot: number, idType: IdTypeKey, side: string, name: string): string {
  return `Guest ${slot} · ${ID_TYPES[idType].label} · ${side} – ${name.trim()}`.slice(0, 80);
}
