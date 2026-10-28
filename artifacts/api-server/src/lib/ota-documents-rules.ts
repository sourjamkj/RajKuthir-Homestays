/**
 * PDFs the OTAs email — booking vouchers, cancellations, monthly commission
 * statements — and how each is filed. Pure; ota-documents.ts stores them.
 *
 * The voucher is what an OTA guest can be given instead of an invoice from
 * us: the OTA collected the money and its document shows the taxes paid.
 */

export type OtaSource = "makeMyTrip" | "bookingCom" | "airbnb";
export type OtaDocumentKind = "voucher" | "cancellation" | "statement" | "other";

const SENDERS: Array<{ pattern: RegExp; source: OtaSource }> = [
  { pattern: /@([a-z0-9-]+\.)*(go-mmt\.com|goibibo\.com|makemytrip\.com|zen2-makemytrip\.com)$/i, source: "makeMyTrip" },
  { pattern: /@([a-z0-9-]+\.)*booking\.com$/i, source: "bookingCom" },
  { pattern: /@([a-z0-9-]+\.)*airbnb\.com$/i, source: "airbnb" },
];

export function otaSourceOf(from: string): OtaSource | null {
  const address = from.trim().toLowerCase();
  return SENDERS.find((sender) => sender.pattern.test(address))?.source ?? null;
}

export function kindOf(subject: string): OtaDocumentKind {
  if (/cancel/i.test(subject)) return "cancellation";
  if (/commission|statement|payout|remittance|invoice for the month/i.test(subject)) return "statement";
  if (/booking|reservation|voucher|confirmed/i.test(subject)) return "voucher";
  return "other";
}

/**
 * The channel's booking number in a subject: MakeMyTrip NH…, Goibibo GH…,
 * Airbnb HM…, Booking.com's ten-digit number.
 */
export function bookingRefOf(subject: string): string | null {
  const match = /\b(NH\d{10,}|GH\d{10,}|NN\d{10,}|HM[A-Z0-9]{8,10}|\d{9,11})\b/.exec(subject);
  return match?.[1] ?? null;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "Commission Income for the month of Oct 2026" -> "2026-10". */
export function periodOf(subject: string): string | null {
  const match = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(20\d{2})\b/i.exec(subject);
  return match ? `${match[2]}-${MONTHS[match[1]!.toLowerCase()]}` : null;
}

export type FiledDocument = {
  source: OtaSource;
  kind: OtaDocumentKind;
  externalRef: string | null;
  period: string | null;
};

/** How an attachment from this email is filed, or null when it is not from an OTA. */
export function fileDocument(input: { from: string; subject: string }): FiledDocument | null {
  const source = otaSourceOf(input.from);
  if (!source) return null;
  const kind = kindOf(input.subject);
  return {
    source,
    kind,
    externalRef: kind === "statement" ? null : bookingRefOf(input.subject),
    period: kind === "statement" ? periodOf(input.subject) : null,
  };
}
