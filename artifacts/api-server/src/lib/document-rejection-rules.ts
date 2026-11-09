/**
 * Rejecting a guest's ID upload.
 *
 * The owner's rule: a rejection always tells the guest why, and always says
 * clearly how to upload again. So the reason is required (a guest told only
 * "rejected" uploads the same blurred photo again), and the pre-arrival page
 * shows the reason above the same upload checklist the WhatsApp message gives.
 */

/** Tap-to-fill reasons the console and the app offer. The owner can still edit. */
export const COMMON_REJECTION_REASONS = [
  "The photo is blurred or too dark to read",
  "Part of the ID is cut off; all four corners must be visible",
  "The back side of the ID is missing",
  "The ID has expired",
  "The name on the ID does not match the guest",
  "This is not an accepted photo ID",
  "IDs are missing for some adults in the group",
] as const;

/** What the guest must do, in the words the page and the message both use. */
export const UPLOAD_INSTRUCTIONS = [
  "One valid government photo ID for every adult staying: Aadhaar, passport, driving licence or voter ID",
  "Front and back, where the ID has two sides",
  "A clear, well-lit photo or scan with all four corners visible, no blur or glare",
  "The name must match the guest, and the ID must not be expired",
  "Foreign nationals: the passport photo page and the Indian visa",
  "PDF, JPG, PNG or WebP, up to 8 MB each, up to 6 files at a time",
  'In "Document type", write the ID and whose it is, e.g. "Aadhaar – Riya Sen"',
] as const;

export const MIN_REASON_LENGTH = 5;
export const MAX_REASON_LENGTH = 300;

/** Null when the reason is fine; otherwise the sentence to show the owner. */
export function rejectionReasonProblem(reason: string | null | undefined): string | null {
  const text = (reason ?? "").trim();
  if (!text) return "Say why the documents are being rejected; the guest is told the reason.";
  if (text.length < MIN_REASON_LENGTH) return "Give the guest a clearer reason, e.g. \"The photo is blurred\".";
  if (text.length > MAX_REASON_LENGTH) return `Keep the reason under ${MAX_REASON_LENGTH} characters.`;
  return null;
}
