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
  'IDs are missing for some adults in the group',
];

export const UPLOAD_INSTRUCTIONS = [
  'One valid government photo ID for every adult staying: Aadhaar, passport, driving licence or voter ID',
  'Front and back, where the ID has two sides',
  'A clear, well-lit photo or scan with all four corners visible, no blur or glare',
  'The name must match the guest, and the ID must not be expired',
  'Foreign nationals: the passport photo page and the Indian visa',
  'PDF, JPG, PNG or WebP, up to 8 MB each, up to 6 files at a time',
  'In "Document type", write the ID and whose it is, e.g. "Aadhaar – Riya Sen"',
];

export const MIN_REJECTION_REASON = 5;

/** "11 November 2026, 12:00 PM" in India time. */
export function prettyDeadline(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}
