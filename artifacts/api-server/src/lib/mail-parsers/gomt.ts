/**
 * Parser for Go-MMT hotelier vouchers — the emails MakeMyTrip and GoIbibo send
 * the property when a booking is made or cancelled.
 *
 * These vouchers arrive as HTML tables, and whatever converts them to text does
 * it inconsistently: one arrives as pipe-delimited rows, the next as flowing
 * prose with the same fields in the same order. Rather than write two parsers,
 * everything is flattened to a single space-separated line first and read with
 * positional regexes. That is resilient to the layout changing again, which it
 * will.
 *
 * Every figure is converted to integer paise at the boundary, matching the rest
 * of the ledger — rupee floats drift once you start summing them.
 */

export type ParsedVoucher = {
  /** The channel's own reservation number, e.g. GH75081277131254. */
  externalRef: string;
  source: "makeMyTrip";
  status: "confirmed" | "cancelled";
  guestName: string | null;
  /** ISO dates. Check-out is exclusive, matching the rest of the codebase. */
  checkIn: string;
  checkOut: string;
  guests: number | null;
  /** What the guest paid, in paise. Null on a cancellation notice. */
  grossPaise: number | null;
  /** Go-MMT commission including GST, in paise. */
  commissionPaise: number | null;
  /** TDS/TCS withheld, in paise. */
  taxPaise: number | null;
  /** What Go-MMT will actually remit, in paise. */
  receivedPaise: number | null;
  /** Kept for the audit trail — which email produced this row. */
  sourceSubject: string;
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Senders whose mail this parser understands. */
export function handlesSender(from: string): boolean {
  return /(^|[@.])(go-mmt|goibibo|makemytrip)\.com/i.test(from);
}

/**
 * Collapses pipes, non-breaking spaces and runs of whitespace into single
 * spaces, so both of the layouts Go-MMT sends read identically to the regexes.
 */
function flatten(body: string): string {
  return body
    .replace(/ /g, " ")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "₹ 4,266.0" -> 426600 paise. Returns null when the figure is absent. */
function paiseAfter(flat: string, label: RegExp): number | null {
  const pattern = new RegExp(
    `${label.source}\\s*₹?\\s*([\\d,]+(?:\\.\\d+)?)`,
    "i",
  );
  const match = pattern.exec(flat);
  if (!match?.[1]) return null;

  const rupees = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(rupees) ? Math.round(rupees * 100) : null;
}

/** "02 Oct '26" -> "2026-10-02". Two-digit years are this century. */
function toIso(day: string, month: string, year: string): string | null {
  const mm = MONTHS[month.toLowerCase().slice(0, 3)];
  if (!mm) return null;
  return `20${year}-${mm}-${day.padStart(2, "0")}`;
}

export function parseGoMmtVoucher(
  subject: string,
  from: string,
  body: string,
): ParsedVoucher | null {
  if (!handlesSender(from)) return null;

  const flat = flatten(body);

  // The reference appears in the subject on both mail types, and in the body
  // on the voucher. Subject first — it is the one field never reformatted.
  const ref =
    /\b([A-Z]{2}\d{12,20})\b/.exec(subject)?.[1] ??
    /Booking ID\s*([A-Z]{2}\d{12,20})\b/i.exec(flat)?.[1] ??
    null;

  if (!ref) return null;

  // Two independent signals, because a cancellation voucher still carries the
  // original booking's dates and reads almost identically otherwise.
  const cancelled =
    /Booking Status\s*CANCELLED/i.test(flat) ||
    /^\s*Cancellation received/i.test(subject);

  const dates = [
    ...flat.matchAll(/(\d{1,2})\s+([A-Za-z]{3})\s*'(\d{2})/g),
  ];

  if (dates.length < 2) return null;

  const checkIn = toIso(dates[0]![1]!, dates[0]![2]!, dates[0]![3]!);
  const checkOut = toIso(dates[1]![1]!, dates[1]![2]!, dates[1]![3]!);

  if (!checkIn || !checkOut || checkOut <= checkIn) return null;

  const guestName =
    /PRIMARY GUEST DETAILS\s+([A-Za-z][A-Za-z .'-]{1,60}?)\s+(?:CHECK-IN|TOTAL|$)/i
      .exec(flat)?.[1]
      ?.trim() ?? null;

  const guests = Number(/(\d+)\s+Adults?/i.exec(flat)?.[1] ?? "");

  return {
    externalRef: ref,
    source: "makeMyTrip",
    status: cancelled ? "cancelled" : "confirmed",
    guestName: guestName || null,
    checkIn,
    checkOut,
    guests: Number.isFinite(guests) && guests > 0 ? guests : null,
    // A cancellation voucher replaces the payment block with cancellation
    // charges, so these come back null and must not overwrite what was stored.
    grossPaise: cancelled ? null : paiseAfter(flat, /Property Gross Charges/),
    commissionPaise: cancelled
      ? null
      : paiseAfter(flat, /Go-MMT Commission \(including GST\)[^₹]*/),
    taxPaise: cancelled ? null : paiseAfter(flat, /Tax Deduction[^₹]*/),
    receivedPaise: cancelled ? null : paiseAfter(flat, /Payable to Property/),
    sourceSubject: subject.slice(0, 200),
  };
}
