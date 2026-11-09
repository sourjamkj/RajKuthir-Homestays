/**
 * Guest invoices: numbering, what goes on one, and when one is emailed.
 *
 * Raj Kuthir Homestays is NOT registered for GST, so this is a plain invoice:
 * no GSTIN, no tax lines, never titled "Tax Invoice". The total is what the
 * guest paid for the stay.
 *
 * Pure — invoices.ts does the database, PDF and email.
 */

export const BUSINESS = {
  name: "Raj Kuthir Homestays – Sobuj Potro",
  address: ["Sobuj, Dopati 148, Potro Bunglow, Bandh Nabagram", "Bolpur, West Bengal 731204, India"],
  phone: "+91 62903 99165",
  website: "rajkuthirhomestays.casa",
} as const;

/** Bookings that came through a channel (and were paid to the channel by the guest). */
export const OTA_SOURCES: readonly string[] = ["bookingCom", "airbnb", "makeMyTrip"];

/**
 * How the guest paid, for the invoice. Booking.com asks for it on every guest
 * invoice and forbids naming Booking.com as the seller, so a channel booking
 * says how the money came, never through whom.
 */
export function paymentMethodLine(input: {
  source: string;
  paidPaise: number;
  /** Book & Pay: the advance's own receipt line (online method or UTR), when known. */
  receipt?: string | null;
}): string | null {
  if (input.paidPaise <= 0) return "Payment: due at the property.";
  if (OTA_SOURCES.includes(input.source)) return "Payment method: card, paid online when the stay was booked.";
  if (input.receipt) return input.receipt;
  return "Payment method: UPI / bank transfer to the property.";
}

/**
 * Channels that charge the guest GST on our stays and pay it themselves: an
 * e-commerce operator is liable for the GST on accommodation it books for a
 * supplier who is not registered (CGST Act 2017, s.9(5)). Booking.com shows
 * it on the reservation ("Goods & services tax"). Its total includes it.
 */
export const PLATFORM_GST_SOURCES: readonly string[] = ["bookingCom"];

/** Accommodation up to ₹7,500 a night is 5%; above it 18%. */
export const GST_LOW_RATE_LIMIT_PAISE = 750_000;

/** Splits a channel total that includes GST into the stay and the GST, in whole rupees. */
export function platformGstSplit(totalPaise: number, nights: number): { basePaise: number; gstPaise: number; ratePercent: 5 | 18 } {
  const rupee = (p: number) => Math.round(p / 100) * 100;
  const low = rupee(totalPaise / 1.05);
  const ratePercent = low / Math.max(1, nights) <= GST_LOW_RATE_LIMIT_PAISE ? 5 : 18;
  const basePaise = ratePercent === 5 ? low : rupee(totalPaise / 1.18);
  return { basePaise, gstPaise: totalPaise - basePaise, ratePercent };
}

export const PLATFORM_GST_NOTE =
  "Raj Kuthir Homestays is not registered under GST. The GST on this stay was charged and paid by the booking platform under section 9(5) of the CGST Act, 2017.";

export const GST_NOTE = "Not registered under GST. No GST has been charged on this invoice.";

/**
 * Own bookings get the automatic email. OTA guests do not: their contact is
 * usually a channel alias. But the channels do NOT invoice the guest for us
 * (Booking.com says so outright: the property is the supplier and issues the
 * invoice for the full stay), so the owner downloads this one and sends it
 * when a guest asks. It never names the channel as the seller.
 */
export const AUTO_EMAIL_SOURCES = ["direct", "manual"] as const;

/** Check-out is by 11 am; the invoice goes at noon IST that day. */
export const SEND_HOUR_IST = 12;
/** After this many days past check-out the automatic email gives up. */
export const SEND_WINDOW_DAYS = 3;

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

export function istDateOf(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function istHourOf(at: Date): number {
  return new Date(at.getTime() + IST_OFFSET_MS).getUTCHours();
}

function addDays(isoDate: string, days: number): string {
  const at = new Date(`${isoDate}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** Indian financial year of a date: 1 Apr 2026 – 31 Mar 2027 is "2026-27". */
export function financialYear(isoDate: string): string {
  const [year, month] = isoDate.split("-").map(Number);
  const start = month! >= 4 ? year! : year! - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** RK/2026-27/0007 — sequential within the financial year, as Indian invoices are. */
export function invoiceNumber(fy: string, sequence: number): string {
  return `RK/${fy}/${String(sequence).padStart(4, "0")}`;
}

/** Next sequence number given the numbers already issued in that year. */
export function nextSequence(fy: string, existing: string[]): number {
  const prefix = `RK/${fy}/`;
  let max = 0;
  for (const number of existing) {
    if (!number.startsWith(prefix)) continue;
    const n = Number(number.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max + 1;
}

/** "5,600" — Indian grouping, whole rupees unless there are paise. */
export function rupeesText(paise: number): string {
  const value = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** The standard PDF fonts have no ₹ glyph, so amounts are written "Rs. 5,600". */
export function money(paise: number): string {
  return `Rs. ${rupeesText(paise)}`;
}

export function prettyDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year!, month! - 1, day!)),
  );
}

export type InvoiceBooking = {
  id: string;
  reference: string | null;
  source: string;
  status: string;
  guestName: string | null;
  guestPhone: string | null;
  checkIn: string;
  checkOut: string;
  guests: number | null;
  pets: number | null;
  grossPaise: number | null;
  receivedPaise: number | null;
};

/** What stops an invoice being made at all. Null when one can be. */
export function invoiceProblem(booking: InvoiceBooking): string | null {
  if (booking.status === "cancelled") return "The booking is cancelled.";
  if (!booking.grossPaise || booking.grossPaise <= 0) {
    return OTA_SOURCES.includes(booking.source)
      ? "Add the full amount the guest paid for the stay first, before the channel's commission (Edit details → Total)."
      : "Add the total for the stay first (Edit details → Total).";
  }
  if (!booking.guestName?.trim()) return "Add the guest's name first.";
  return null;
}

export type InvoiceLine = { description: string; detail: string; amountPaise: number };

export type InvoiceContent = {
  number: string;
  issuedOn: string;
  billedTo: { name: string; phone: string | null; email: string | null };
  stay: { reference: string | null; checkIn: string; checkOut: string; nights: number; guests: number | null; pets: number };
  lines: InvoiceLine[];
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  /** Replaces the usual "No GST has been charged" line when a platform paid the GST. */
  gstNote?: string;
};

export function invoiceContent(input: {
  booking: InvoiceBooking;
  number: string;
  issuedOn: string;
  email: string | null;
}): InvoiceContent {
  const { booking } = input;
  const total = booking.grossPaise ?? 0;
  // A channel guest paid the channel in full; what reached us is the payout, not what they paid.
  const paid = OTA_SOURCES.includes(booking.source) ? total : Math.min(total, Math.max(0, booking.receivedPaise ?? 0));
  const nights = nightsBetween(booking.checkIn, booking.checkOut);
  const pets = booking.pets ?? 0;
  const party = [
    booking.guests ? `${booking.guests} guest${booking.guests === 1 ? "" : "s"}` : null,
    pets ? `${pets} pet${pets === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const stayDetail = `${prettyDate(booking.checkIn)} to ${prettyDate(booking.checkOut)} · ${nights} night${nights === 1 ? "" : "s"}${party ? ` · ${party}` : ""}`;
  const platformGst = PLATFORM_GST_SOURCES.includes(booking.source) ? platformGstSplit(total, nights) : null;
  const lines = (): InvoiceLine[] =>
    platformGst
      ? [
          { description: "Accommodation – entire two-bedroom villa", detail: stayDetail, amountPaise: platformGst.basePaise },
          {
            description: `GST @ ${platformGst.ratePercent}%`,
            detail: "Charged and paid by the booking platform (CGST Act 2017, s.9(5))",
            amountPaise: platformGst.gstPaise,
          },
        ]
      : [{ description: "Accommodation – entire two-bedroom villa", detail: stayDetail, amountPaise: total }];

  return {
    number: input.number,
    issuedOn: input.issuedOn,
    billedTo: { name: booking.guestName!.trim(), phone: booking.guestPhone, email: input.email },
    stay: { reference: booking.reference, checkIn: booking.checkIn, checkOut: booking.checkOut, nights, guests: booking.guests, pets },
    lines: lines(),
    totalPaise: total,
    paidPaise: paid,
    balancePaise: total - paid,
    ...(platformGst ? { gstNote: PLATFORM_GST_NOTE } : {}),
  };
}

export type AutoEmailDecision =
  /** Email when there is an address; otherwise WhatsApp (the PDF attached) when that is set up. */
  | { send: true; channel: "email" | "whatsapp" }
  /** `waiting` shows in the console as something the owner can fix; `skip` is final. */
  | { send: false; reason: string; kind: "not_yet" | "waiting" | "skip" };

/**
 * Whether the automatic check-out email should go now. Only for our own
 * bookings, only from noon on check-out day for three days, only when the
 * stay is fully paid (an invoice showing a balance due is not sent to a
 * guest who paid in cash at the door — the owner records it first), and
 * only when there is an email address.
 */
export function autoEmailDecision(input: {
  booking: InvoiceBooking;
  email: string | null;
  /** Sent already, by email or WhatsApp. */
  alreadyEmailed: boolean;
  /**
   * The guest's WhatsApp number when invoices can go by WhatsApp (Cloud API
   * on and the invoice template set); null otherwise.
   */
  whatsappTo?: string | null;
  now: Date;
}): AutoEmailDecision {
  const { booking, now } = input;
  if (input.alreadyEmailed) return { send: false, reason: "Already sent", kind: "skip" };
  if (!(AUTO_EMAIL_SOURCES as readonly string[]).includes(booking.source)) {
    return { send: false, reason: "Channel booking: the channel does not invoice the guest, so download this invoice (full stay amount) and send it if the guest asks", kind: "skip" };
  }
  if (booking.status !== "confirmed") return { send: false, reason: "Booking is not confirmed", kind: "skip" };

  const today = istDateOf(now);
  if (today < booking.checkOut || (today === booking.checkOut && istHourOf(now) < SEND_HOUR_IST)) {
    return { send: false, reason: `Emails at ${SEND_HOUR_IST}:00 on check-out day`, kind: "not_yet" };
  }
  if (today > addDays(booking.checkOut, SEND_WINDOW_DAYS)) {
    return { send: false, reason: "More than 3 days after check-out — send it by hand if needed", kind: "skip" };
  }

  const problem = invoiceProblem(booking);
  if (problem) return { send: false, reason: problem, kind: "waiting" };
  if ((booking.receivedPaise ?? 0) < (booking.grossPaise ?? 0)) {
    return { send: false, reason: "Balance not recorded as received — press “Paid in full” to send", kind: "waiting" };
  }
  if (input.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return { send: true, channel: "email" };
  if (input.whatsappTo) return { send: true, channel: "whatsapp" };
  return { send: false, reason: "No email on file — press WhatsApp to send it to the guest", kind: "waiting" };
}

export function invoiceEmail(content: InvoiceContent): { subject: string; text: string } {
  const first = content.billedTo.name.split(/\s+/)[0] || "there";
  return {
    subject: `Invoice ${content.number} — your stay at Raj Kuthir Homestays`,
    text: [
      `Hello ${first},`,
      "",
      `Thank you for staying with us at ${BUSINESS.name}. Please find your invoice ${content.number} attached for your stay from ${prettyDate(content.stay.checkIn)} to ${prettyDate(content.stay.checkOut)}.`,
      "",
      `Total: ${money(content.totalPaise)}`,
      content.balancePaise > 0 ? `Balance due: ${money(content.balancePaise)}` : "Paid in full — thank you.",
      "",
      `Any questions, call or WhatsApp ${BUSINESS.phone}.`,
      "",
      "Warm Regards,",
      "Sourja Mukherjee",
      BUSINESS.name,
    ].join("\n"),
  };
}

/** The words of the invoice WhatsApp — the PDF rides along as the template's document header. */
export function invoiceWhatsappParams(content: InvoiceContent): string[] {
  return [content.billedTo.name.split(/\s+/)[0] || "there", content.number];
}

/**
 * The manual fallback when the Cloud API is not set up: a message the owner
 * sends from their own WhatsApp, with a private link to the PDF.
 */
export function invoiceWhatsappText(content: InvoiceContent, link: string): string {
  const first = content.billedTo.name.split(/\s+/)[0] || "there";
  return [
    `Hello ${first}, thank you for staying with us at ${BUSINESS.name}.`,
    "",
    `Your invoice ${content.number} for ${prettyDate(content.stay.checkIn)} to ${prettyDate(content.stay.checkOut)} is here: ${link}`,
    "",
    `Total: ${money(content.totalPaise)}${content.balancePaise > 0 ? ` · Balance due: ${money(content.balancePaise)}` : " · Paid in full"}`,
    "",
    "Warm Regards,",
    "Sourja Mukherjee",
    BUSINESS.name,
  ].join("\n");
}

/** The email that carries the booking confirmation PDF (owner-made bookings). */
export function confirmationEmail(content: InvoiceContent): { subject: string; text: string } {
  const first = content.billedTo.name.split(/\s+/)[0] || "there";
  return {
    subject: `Booking confirmed — ${content.stay.reference ?? content.number}`,
    text: [
      `Hello ${first}, your stay at ${BUSINESS.name} is confirmed.`,
      "",
      // The RK- reference is what /welcome and the pre-arrival form ask for;
      // the confirmation number is the one the invoice will carry.
      `Booking reference: ${content.stay.reference ?? content.number}`,
      ...(content.stay.reference ? [`Confirmation no.: ${content.number}`] : []),
      `Check-in: ${prettyDate(content.stay.checkIn)} (from 12 noon)`,
      `Check-out: ${prettyDate(content.stay.checkOut)} (by 11 am)`,
      `Total: ${money(content.totalPaise)}`,
      `Advance received: ${money(content.paidPaise)}`,
      `Balance at check-in: ${money(content.balancePaise)}`,
      "",
      "Your booking confirmation is attached, with a QR code to pay the balance by UPI.",
      "",
      `Any questions, call or WhatsApp ${BUSINESS.phone}.`,
      "",
      "Warm Regards,",
      "Sourja Mukherjee",
      BUSINESS.name,
    ].join("\n"),
  };
}
