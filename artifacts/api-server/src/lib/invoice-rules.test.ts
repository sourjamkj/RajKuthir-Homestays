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
