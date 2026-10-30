import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { BUSINESS, GST_NOTE, money, prettyDate, type InvoiceContent } from "./invoice-rules.ts";
import { INVOICE_LOGO_JPEG_BASE64 } from "./invoice-logo.ts";

/**
 * Renders an invoice as an A4 PDF: the villa photo mark, the business, the
 * guest, the stay, one line, the totals, and the GST note. Standard fonts
 * only (Helvetica), so nothing to ship but the logo.
 */

/** The logo, checked to really be a JPEG before pdf-lib is asked to draw it. */
function logoBytes(): Uint8Array | null {
  const bytes = Buffer.from(INVOICE_LOGO_JPEG_BASE64, "base64");
  return isJpeg(bytes) ? new Uint8Array(bytes) : null;
}

/** A JPEG starts FF D8 FF; anything else makes pdf-lib throw "SOI not found". */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

const GREEN = rgb(0x2d / 255, 0x66 / 255, 0x58 / 255);
const INK = rgb(0.13, 0.15, 0.14);
const MUTED = rgb(0.42, 0.45, 0.43);
const RULE = rgb(0.85, 0.83, 0.78);
const PAPER = rgb(0.97, 0.95, 0.91);

/**
 * The standard PDF fonts can only draw WinAnsi characters; anything else
 * (a Bengali or accented name, an emoji in a booking note, ₹) would throw
 * and fail the whole PDF. Accents are dropped, ₹ becomes "Rs.", and
 * anything still unsupported becomes "?".
 */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
export function pdfSafe(text: string): string {
  return text
    .replace(/₹\s?/g, "Rs. ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\n]/g, (char) => {
      const code = char.codePointAt(0)!;
      return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(char) ? char : "?";
    });
}

function rightText(page: PDFPage, text: string, x: number, y: number, size: number, font: PDFFont, color = INK) {
  const safe = pdfSafe(text);
  page.drawText(safe, { x: x - font.widthOfTextAtSize(safe, size), y, size, font, color });
}

/** Very small word-wrap for the address and detail lines. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** For a booking confirmation: how to pay the balance, with a UPI QR. */
export type BalancePayment = { upiId: string; payeeName: string; qrPng: Uint8Array; note: string };

export async function renderInvoicePdf(
  invoice: InvoiceContent,
  options: {
    kind?: "invoice" | "confirmation";
    payment?: BalancePayment | null;
    /** How the advance was paid, e.g. "Paid online … · UPI · Cashfree payment ID …". */
    receipt?: string | null;
  } = {},
): Promise<Uint8Array> {
  const confirmation = options.kind === "confirmation";
  const pdf = await PDFDocument.create();
  pdf.setTitle(confirmation ? `Booking confirmation ${invoice.number}` : `Invoice ${invoice.number}`);
  pdf.setAuthor(BUSINESS.name);
  pdf.setCreator(BUSINESS.website);

  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const left = 48;
  const right = 595.28 - 48;
  let y = 841.89 - 56;

  // Header band
  page.drawRectangle({ x: 0, y: y - 70, width: 595.28, height: 126, color: PAPER });
  const logo = logoBytes();
  let textX = left;
  if (logo) {
    // The logo is decoration: if it cannot be drawn, the document still goes.
    try {
      const image = await pdf.embedJpg(logo);
      page.drawImage(image, { x: left, y: y - 58, width: 72, height: 72 });
      textX = left + 88;
    } catch {
      textX = left;
    }
  }
  page.drawText(pdfSafe(BUSINESS.name), { x: textX, y: y - 4, size: 15, font: bold, color: GREEN });
  let headerY = y - 22;
  for (const line of [...BUSINESS.address, `${BUSINESS.phone}  ·  ${BUSINESS.website}`]) {
    page.drawText(pdfSafe(line), { x: textX, y: headerY, size: 9, font: regular, color: MUTED });
    headerY -= 12;
  }
  if (confirmation) {
    rightText(page, "BOOKING", right, y + 12, 9, bold, MUTED);
    rightText(page, "CONFIRMATION", right, y - 4, 16, bold, GREEN);
  } else {
    rightText(page, "INVOICE", right, y - 4, 20, bold, GREEN);
  }
  rightText(page, confirmation ? `Ref: ${invoice.number}` : invoice.number, right, y - 24, 10, bold);
  rightText(page, `Date: ${prettyDate(invoice.issuedOn)}`, right, y - 38, 9, regular, MUTED);
  if (confirmation) {
    // The one word the guest is looking for, impossible to miss.
    const stamp = "CONFIRMED";
    const width = bold.widthOfTextAtSize(stamp, 10) + 16;
    page.drawRectangle({ x: right - width, y: y - 60, width, height: 17, color: GREEN });
    page.drawText(stamp, { x: right - width + 8, y: y - 55, size: 10, font: bold, color: rgb(1, 1, 1) });
  }

  y -= 110;

  // Billed to / Stay
  page.drawText(pdfSafe(confirmation ? "GUEST" : "BILLED TO"), { x: left, y, size: 8, font: bold, color: MUTED });
  page.drawText(pdfSafe("STAY"), { x: 320, y, size: 8, font: bold, color: MUTED });
  y -= 16;
  const billed = [invoice.billedTo.name, invoice.billedTo.phone, invoice.billedTo.email].filter(Boolean) as string[];
  const stay = [
    `Check-in: ${prettyDate(invoice.stay.checkIn)}, from 12 noon`,
    `Check-out: ${prettyDate(invoice.stay.checkOut)}, by 11 am`,
    `${invoice.stay.nights} night${invoice.stay.nights === 1 ? "" : "s"}`,
    invoice.stay.reference ? `Booking reference: ${invoice.stay.reference}` : null,
  ].filter(Boolean) as string[];
  for (let i = 0; i < Math.max(billed.length, stay.length); i += 1) {
    if (billed[i]) page.drawText(pdfSafe(billed[i]!), { x: left, y, size: i === 0 ? 11 : 10, font: i === 0 ? bold : regular, color: INK });
    if (stay[i]) page.drawText(pdfSafe(stay[i]!), { x: 320, y, size: 10, font: regular, color: INK });
    y -= 15;
  }

  // Lines table
  y -= 18;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: GREEN });
  y -= 14;
  page.drawText(pdfSafe("DESCRIPTION"), { x: left, y, size: 8, font: bold, color: MUTED });
  rightText(page, "AMOUNT", right, y, 8, bold, MUTED);
  y -= 8;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: RULE });

  for (const line of invoice.lines) {
    y -= 18;
    page.drawText(pdfSafe(line.description), { x: left, y, size: 11, font: bold, color: INK });
    rightText(page, money(line.amountPaise), right, y, 11, bold);
    for (const detail of wrap(pdfSafe(line.detail), regular, 9, 360)) {
      y -= 13;
      page.drawText(pdfSafe(detail), { x: left, y, size: 9, font: regular, color: MUTED });
    }
    y -= 10;
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: RULE });
  }

  // Totals
  const totalsX = 360;
  const row = (label: string, value: string, strong = false) => {
    y -= 18;
    page.drawText(pdfSafe(label), { x: totalsX, y, size: strong ? 11 : 10, font: strong ? bold : regular, color: strong ? INK : MUTED });
    rightText(page, value, right, y, strong ? 11 : 10, strong ? bold : regular);
  };
  row("Total", money(invoice.totalPaise), true);
  row(confirmation ? "Advance received" : "Amount paid", money(invoice.paidPaise));
  row(confirmation ? "Balance (at check-in)" : "Balance due", money(invoice.balancePaise), invoice.balancePaise > 0);
  if (options.receipt) {
    for (const line of wrap(pdfSafe(options.receipt), regular, 8.5, right - left)) {
      y -= 14;
      rightText(page, line, right, y, 8.5, regular, MUTED);
    }
  }

  // Confirmation: how to pay the balance — scan the QR or use the UPI ID.
  if (confirmation && invoice.balancePaise > 0 && options.payment) {
    const qr = await pdf.embedPng(options.payment.qrPng);
    const top = y - 34;
    page.drawText(pdfSafe("PAY THE BALANCE"), { x: left, y: top, size: 8, font: bold, color: MUTED });
    page.drawImage(qr, { x: left, y: top - 132, width: 122, height: 122 });
    const info = [
      `Scan with any UPI app (GPay, PhonePe, Paytm)`,
      `UPI ID: ${options.payment.upiId}`,
      `Name: ${options.payment.payeeName}`,
      `Amount: ${money(invoice.balancePaise)}`,
      `Note: ${options.payment.note}`,
      `Payable at check-in on ${prettyDate(invoice.stay.checkIn)}.`,
    ];
    let infoY = top - 22;
    for (const [index, line] of info.entries()) {
      page.drawText(pdfSafe(line), { x: left + 134, y: infoY, size: index === 1 || index === 3 ? 10 : 9, font: index === 1 || index === 3 ? bold : regular, color: index === 1 || index === 3 ? INK : MUTED });
      infoY -= 15;
    }
    y = Math.min(y, top - 140);
  }

  if (invoice.balancePaise === 0) {
    y -= 26;
    page.drawRectangle({ x: totalsX - 8, y: y - 6, width: right - totalsX + 8, height: 22, color: GREEN });
    page.drawText(pdfSafe("PAID IN FULL"), { x: totalsX, y, size: 10, font: bold, color: rgb(1, 1, 1) });
  }

  // Footer
  const footer = confirmation
    ? [
        "Your stay is confirmed. We look forward to welcoming you to Sobuj Potro.",
        `Check-in from 12 noon, check-out by 11 am. Questions: ${BUSINESS.phone} (call or WhatsApp).`,
        "This confirmation is not a tax invoice. " + GST_NOTE.replace(" on this invoice", ""),
      ]
    : [
        "Thank you for staying with us. We hope to welcome you back to Sobuj Potro.",
        GST_NOTE,
        "This is a computer-generated invoice and needs no signature.",
      ];
  let fy = 72;
  for (const line of footer) {
    page.drawText(pdfSafe(line), { x: left, y: fy, size: 8.5, font: line === footer[0] ? bold : regular, color: line === footer[0] ? GREEN : MUTED });
    fy -= 12;
  }

  return pdf.save();
}
