import { formatDeadline } from "./enquiry-hold.ts";
import { rupees } from "./whatsapp-templates.ts";

/**
 * The words of Book & Pay. Pure: the routes and the expiry job decide who
 * receives them and over which channel.
 */

const HOST_PHONE = "+91 62903 99165";

function prettyDate(iso: string | null): string {
  if (!iso) return "?";
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function firstName(full: string | null): string {
  return (full ?? "").trim().split(/\s+/)[0] || "there";
}

/** Sent when the owner confirms. Reference, dates, balance, pre-arrival link. */
export function confirmedMessage(input: {
  guestName: string | null;
  reference: string;
  checkIn: string | null;
  checkOut: string | null;
  advancePaise: number;
  balancePaise: number;
  preArrivalUrl: string | null;
}): { subject: string; text: string } {
  const lines = [
    `Hello ${firstName(input.guestName)}, your stay at Raj Kuthir Homestays – Sobuj Potro is confirmed.`,
    "",
    `Booking reference: ${input.reference}`,
    `Check-in: ${prettyDate(input.checkIn)} (from 12 noon)`,
    `Check-out: ${prettyDate(input.checkOut)} (by 11 am)`,
    `Advance received: ₹${rupees(input.advancePaise)}`,
    `Balance due at check-in: ₹${rupees(input.balancePaise)}`,
  ];
  if (input.preArrivalUrl) {
    lines.push(
      "",
      "Please complete the pre-arrival check-in (guest details and ID) at least 48 hours before arrival:",
      input.preArrivalUrl,
    );
  }
  lines.push("", `Any questions, call or WhatsApp ${HOST_PHONE}.`, "", "Team Raj Kuthir Homestays");
  return { subject: `Booking confirmed — ${input.reference}`, text: lines.join("\n") };
}

/** Sent once when an unpaid hold runs out. */
export function expiredMessage(input: {
  guestName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  rebookUrl: string;
}): { subject: string; text: string } {
  return {
    subject: "Your hold at Raj Kuthir Homestays has expired",
    text: [
      `Hello ${firstName(input.guestName)}, we held ${prettyDate(input.checkIn)} to ${prettyDate(input.checkOut)} for you, ` +
        "but the advance did not reach us in time, so the dates have been released.",
      "",
      `If you would still like to stay, you can book again here: ${input.rebookUrl}`,
      `If you already paid, please WhatsApp the payment screenshot to ${HOST_PHONE} and we will sort it out straight away.`,
      "",
      "Team Raj Kuthir Homestays",
    ].join("\n"),
  };
}

/** The owner's alert when a guest submits a UTR. */
export function ownerUtrAlert(input: {
  guestName: string;
  guestPhone: string;
  reference: string;
  checkIn: string | null;
  checkOut: string | null;
  advancePaise: number;
  utr: string;
  hasScreenshot: boolean;
  decideBy: Date;
  adminUrl: string;
}): { subject: string; text: string } {
  return {
    subject: `Payment to verify: ₹${rupees(input.advancePaise)} — ${input.guestName} (${input.reference})`,
    text: [
      `${input.guestName} (${input.guestPhone}) says they have paid the advance.`,
      "",
      `Amount: ₹${rupees(input.advancePaise)}`,
      `UTR: ${input.utr}`,
      `UPI note: ${input.reference}`,
      `Stay: ${prettyDate(input.checkIn)} → ${prettyDate(input.checkOut)}`,
      `Screenshot: ${input.hasScreenshot ? "attached in the console" : "none"}`,
      "",
      `Check your bank app for this UTR, then confirm or reject: ${input.adminUrl}`,
      `The dates stay held until you decide (please by ${formatDeadline(input.decideBy)}).`,
    ].join("\n"),
  };
}

/**
 * The owner's note when a guest pays online through Cashfree. `confirmed` is
 * whether the booking was made automatically; when it was not, `problem`
 * says why and the owner decides (and refunds if needed) from the console.
 */
export function ownerOnlinePaymentAlert(input: {
  guestName: string;
  guestPhone: string;
  reference: string;
  checkIn: string | null;
  checkOut: string | null;
  amountPaise: number;
  method: string;
  cfPaymentId: string | null;
  confirmed: boolean;
  problem: string | null;
  adminUrl: string;
}): { subject: string; text: string } {
  const head = input.confirmed
    ? `Paid online and booked: ₹${rupees(input.amountPaise)} — ${input.guestName} (${input.reference})`
    : `Paid online — needs your check: ₹${rupees(input.amountPaise)} — ${input.guestName} (${input.reference})`;
  return {
    subject: head,
    text: [
      input.confirmed
        ? `${input.guestName} (${input.guestPhone}) paid the advance online. The booking is confirmed and the guest has their confirmation.`
        : `${input.guestName} (${input.guestPhone}) paid the advance online, but the booking was NOT made automatically.`,
      ...(input.problem ? ["", input.confirmed ? `Note: ${input.problem}` : `Why: ${input.problem}`] : []),
      "",
      `Amount: ₹${rupees(input.amountPaise)} (${input.method})`,
      `Cashfree payment ID: ${input.cfPaymentId ?? "—"}`,
      `Stay: ${prettyDate(input.checkIn)} → ${prettyDate(input.checkOut)}`,
      "",
      input.confirmed
        ? `Details: ${input.adminUrl}`
        : `The dates stay held. Confirm or refund from the console: ${input.adminUrl}`,
    ].join("\n"),
  };
}
