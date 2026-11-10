/**
 * Guest ID uploads: what to tell a guest, and the reasons the owner can pick
 * when rejecting. Mirrors api-server/src/lib/document-rejection-rules.ts and
 * owner-app/src/guestMessages.ts, so the page, the console and the app agree.
 */

export const COMMON_REJECTION_REASONS = [
  'The photo is blurred or too dark to read',
  'Part of the ID is cut off; all four corners must be visible',
  'The back side of the ID is missing',
  'The ID has expired',
  'The name on the ID does not match the guest',
  'This is not an accepted photo ID',
  'IDs are missing for some guests in the group',
];

export const UPLOAD_INSTRUCTIONS = [
  'One photo ID for every guest, children included. Adults: Aadhaar, passport, driving licence or voter ID. Children: Aadhaar, passport, school ID or birth certificate',
  'Front and back, where the ID has two sides (one PDF with both sides, like the e-Aadhaar, is fine)',
  'A clear, well-lit photo or scan with all four corners visible, no blur or glare',
  'The name must match the guest, and the ID must not be expired',
  'Foreign nationals: the passport photo page and the Indian visa',
  'A camera photo, or a PDF under 4 MB. Photos are made smaller automatically',
  'Fill one card per guest on the upload page, with the name as it is on the ID',
];

export const MIN_REJECTION_REASON = 5;

/** "11 November 2026, 12:00 PM" in India time. */
export function prettyDeadline(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

/** Mirrors api-server guest-id-rules.ts: which photos each ID needs, and who may use it. */
export type IdTypeKey = 'aadhaar' | 'passport' | 'dl' | 'voter' | 'school' | 'birth';
export const ID_TYPES: Record<IdTypeKey, { label: string; sides: string[]; adult: boolean; child: boolean }> = {
  aadhaar: { label: 'Aadhaar', sides: ['Front', 'Back'], adult: true, child: true },
  passport: { label: 'Passport', sides: ['Photo page'], adult: true, child: true },
  dl: { label: 'Driving licence', sides: ['Front', 'Back'], adult: true, child: false },
  voter: { label: 'Voter ID', sides: ['Front', 'Back'], adult: true, child: false },
  school: { label: 'School ID', sides: ['Front'], adult: false, child: true },
  birth: { label: 'Birth certificate', sides: ['Certificate'], adult: false, child: true },
};
export const VISA_SIDE = 'Indian visa';
/** Mirrors PDF_BOTH_SIDES on the server: one PDF with both sides of the ID. */
export const PDF_BOTH_SIDES = 'Front and back (PDF)';
export function requiredSides(idType: IdTypeKey, foreign: boolean): string[] {
  const sides = [...ID_TYPES[idType].sides];
  if (foreign && idType === 'passport') sides.push(VISA_SIDE);
  return sides;
}
export type ExtraGuestRates = { includedGuests: number; ladderPaise: number; ladderMax: number; abovePaise: number };
export function extraGuestPerNightPaise(booked: number, listed: number, rates: ExtraGuestRates): number {
  let total = 0;
  for (let n = Math.max(1, booked) + 1; n <= listed; n += 1) {
    if (n <= rates.includedGuests) continue;
    total += n <= rates.ladderMax ? rates.ladderPaise : rates.abovePaise;
  }
  return total;
}

/** One group per guest for the owner's review; `slot: null` is an earlier, ungrouped upload. */
export type DocGuest = { slot: number; name: string; age: string; idType: string; side: string };
export function groupByGuest<T extends { guest?: DocGuest | null; status: string; rejectionReason: string | null }>(docs: T[]) {
  const groups = new Map<number | null, { slot: number | null; name: string | null; idType: string | null; age: string | null; docs: T[]; rejected: boolean; reason: string | null }>();
  for (const doc of docs) {
    const key = doc.guest?.slot ?? null;
    const group = groups.get(key) ?? { slot: key, name: doc.guest?.name ?? null, idType: doc.guest?.idType ?? null, age: doc.guest?.age ?? null, docs: [], rejected: false, reason: null };
    group.docs.push(doc);
    if (doc.status === 'rejected') { group.rejected = true; group.reason = group.reason ?? doc.rejectionReason; }
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
}

export const idTypeLabel = (key: string | null) => (key && key in ID_TYPES ? ID_TYPES[key as IdTypeKey].label : 'ID');
