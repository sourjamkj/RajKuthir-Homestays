import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GST_NOTE,
  autoEmailDecision,
  financialYear,
  invoiceContent,
  invoiceEmail,
  invoiceNumber,
  invoiceProblem,
  invoiceWhatsappParams,
  invoiceWhatsappText,
  confirmationEmail,
  money,
  nextSequence,
  type InvoiceBooking,
} from "./invoice-rules.ts";
import { renderInvoicePdf } from "./invoice-pdf.ts";

const ist = (date: string, hh: number) => new Date(Date.parse(`${date}T${String(hh).padStart(2, "0")}:00:00+05:30`));

const booking = (over: Partial<InvoiceBooking> = {}): InvoiceBooking => ({
  id: "b1",
  reference: "RK-18NOV-AB12C",
  source: "direct",
  status: "confirmed",
  guestName: "Rana Datta",
  guestPhone: "+91 98300 40042",
  checkIn: "2026-11-18",
  checkOut: "2026-11-20",
  guests: 2,
  pets: 0,
  grossPaise: 560000,
  receivedPaise: 560000,
  ...over,
});

test("financial year runs April to March", () => {
  assert.equal(financialYear("2026-04-01"), "2026-27");
  assert.equal(financialYear("2027-03-31"), "2026-27");
  assert.equal(financialYear("2026-03-31"), "2025-26");
});

test("numbers are sequential within the year and restart in a new one", () => {
  assert.equal(invoiceNumber("2026-27", 7), "RK/2026-27/0007");
  assert.equal(nextSequence("2026-27", []), 1);
  assert.equal(nextSequence("2026-27", ["RK/2026-27/0001", "RK/2026-27/0009", "RK/2025-26/0040"]), 10);
  assert.equal(nextSequence("2027-28", ["RK/2026-27/0009"]), 1);
});

test("amounts are written Rs. with Indian grouping", () => {
  assert.equal(money(560000), "Rs. 5,600");
  assert.equal(money(12450000), "Rs. 1,24,500");
});

test("no invoice without a total or a name, or for a cancelled stay", () => {
  assert.match(invoiceProblem(booking({ grossPaise: null })) ?? "", /total/);
  assert.match(invoiceProblem(booking({ guestName: " " })) ?? "", /name/);
  assert.ok(invoiceProblem(booking({ status: "cancelled" })));
  assert.equal(invoiceProblem(booking()), null);
});

test("content: one accommodation line, paid and balance from the booking", () => {
  const content = invoiceContent({ booking: booking({ receivedPaise: 280000 }), number: "RK/2026-27/0001", issuedOn: "2026-11-20", email: null });
  assert.equal(content.lines.length, 1);
  assert.match(content.lines[0]!.detail, /2 nights · 2 guests/);
  assert.equal(content.totalPaise, 560000);
  assert.equal(content.paidPaise, 280000);
  assert.equal(content.balancePaise, 280000);
});

test("auto email: own booking, noon on check-out day, fully paid, with an email", () => {
  const ok = { booking: booking(), email: "rana@example.com", alreadyEmailed: false };
  assert.equal(autoEmailDecision({ ...ok, now: ist("2026-11-20", 11) }).send, false);
  assert.equal(autoEmailDecision({ ...ok, now: ist("2026-11-20", 12) }).send, true);
  assert.equal(autoEmailDecision({ ...ok, now: ist("2026-11-23", 20) }).send, true);
  assert.equal(autoEmailDecision({ ...ok, now: ist("2026-11-24", 9) }).send, false);
});

test("auto email: never for OTA bookings, never twice", () => {
  const now = ist("2026-11-20", 13);
  const ota = autoEmailDecision({ booking: booking({ source: "bookingCom" }), email: "x@y.com", alreadyEmailed: false, now });
  assert.equal(ota.send, false);
  if (!ota.send) assert.equal(ota.kind, "skip");
  assert.equal(autoEmailDecision({ booking: booking(), email: "x@y.com", alreadyEmailed: true, now }).send, false);
});

test("auto email: waits for the balance to be recorded and for an email address", () => {
  const now = ist("2026-11-20", 13);
  const unpaid = autoEmailDecision({ booking: booking({ receivedPaise: 280000 }), email: "x@y.com", alreadyEmailed: false, now });
  assert.equal(unpaid.send, false);
  if (!unpaid.send) {
    assert.equal(unpaid.kind, "waiting");
    assert.match(unpaid.reason, /Paid in full/);
  }
  const noEmail = autoEmailDecision({ booking: booking(), email: null, alreadyEmailed: false, now });
  assert.equal(noEmail.send, false);
  if (!noEmail.send) assert.equal(noEmail.kind, "waiting");
});

test("email text names the invoice and says paid in full", () => {
  const content = invoiceContent({ booking: booking(), number: "RK/2026-27/0001", issuedOn: "2026-11-20", email: "rana@example.com" });
  const email = invoiceEmail(content);
  assert.match(email.subject, /RK\/2026-27\/0001/);
  assert.match(email.text, /Paid in full/);
  assert.match(email.text, /^Hello Rana,/);
});

test("the PDF renders, says INVOICE (not Tax Invoice) and carries the GST note", async () => {
  const content = invoiceContent({ booking: booking(), number: "RK/2026-27/0001", issuedOn: "2026-11-20", email: null });
  const bytes = await renderInvoicePdf(content);
  assert.ok(bytes.length > 2000);
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  assert.match(GST_NOTE, /Not registered under GST/);
});

test("auto send: email when there is one, else WhatsApp when it is set up", () => {
  const now = ist("2026-11-20", 13);
  const withEmail = autoEmailDecision({ booking: booking(), email: "x@y.com", alreadyEmailed: false, whatsappTo: "919830040042", now });
  assert.deepEqual(withEmail, { send: true, channel: "email" });
  const noEmail = autoEmailDecision({ booking: booking(), email: null, alreadyEmailed: false, whatsappTo: "919830040042", now });
  assert.deepEqual(noEmail, { send: true, channel: "whatsapp" });
  const neither = autoEmailDecision({ booking: booking(), email: null, alreadyEmailed: false, whatsappTo: null, now });
  assert.equal(neither.send, false);
  if (!neither.send) assert.match(neither.reason, /WhatsApp/);
});

test("WhatsApp message and params name the guest and the invoice", () => {
  const content = invoiceContent({ booking: booking(), number: "RK/2026-27/0002", issuedOn: "2026-11-20", email: null });
  assert.deepEqual(invoiceWhatsappParams(content), ["Rana", "RK/2026-27/0002"]);
  const text = invoiceWhatsappText(content, "https://rajkuthirhomestays.casa/invoice#abc");
  assert.match(text, /^Hello Rana,/);
  assert.match(text, /invoice#abc/);
  assert.match(text, /Paid in full/);
});

test("the booking confirmation renders with a QR for the balance", async () => {
  const QRCode = (await import("qrcode")).default;
  const content = invoiceContent({ booking: booking({ receivedPaise: 280000 }), number: "RK-18NOV-AB12C", issuedOn: "2026-10-28", email: null });
  const qrPng = new Uint8Array(await QRCode.toBuffer("upi://pay?pa=test@ybl&am=2800.00", { type: "png" }));
  const bytes = await renderInvoicePdf(content, {
    kind: "confirmation",
    payment: { upiId: "test@ybl", payeeName: "Raj Kuthir Homestays", qrPng, note: "RK-18NOV-AB12C" },
  });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  const email = confirmationEmail(content);
  assert.match(email.subject, /RK-18NOV-AB12C/);
  assert.match(email.text, /Balance at check-in: Rs\. 2,800/);
});

test("PDFs never fail on names the standard fonts cannot draw", async () => {
  const { pdfSafe } = await import("./invoice-pdf.ts");
  assert.equal(pdfSafe("Rs. ₹5,600"), "Rs. Rs. 5,600");
  assert.equal(pdfSafe("Śrīmatī Dās"), "Srimati Das");
  assert.equal(pdfSafe("অমিত 🙂"), "???? ??");
  for (const guestName of ["অমিত দাস", "José Ñúñez 🙂", "Ananya “Annie” Roy"]) {
    const content = invoiceContent({ booking: booking({ guestName }), number: "RK/2026-27/0003", issuedOn: "2026-11-20", email: null });
    const bytes = await renderInvoicePdf(content);
    assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-", guestName);
  }
});

test("the logo carried in the code is a real JPEG, and a bad one never fails the PDF", async () => {
  const { isJpeg } = await import("./invoice-pdf.ts");
  const { INVOICE_LOGO_JPEG_BASE64 } = await import("./invoice-logo.ts");
  assert.ok(isJpeg(Buffer.from(INVOICE_LOGO_JPEG_BASE64, "base64")));
  assert.ok(!isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])));
  const content = invoiceContent({ booking: booking(), number: "RK/2026-27/0004", issuedOn: "2026-11-20", email: null });
  const bytes = await renderInvoicePdf(content, { kind: "confirmation" });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
});
