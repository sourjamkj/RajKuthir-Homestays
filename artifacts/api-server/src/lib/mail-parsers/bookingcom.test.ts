import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { handlesSender, parseBookingComEmail, resolveNoticeCheckOut } from "./bookingcom.ts";
import { parseMessage } from "./index.ts";

/**
 * Fixtures are real Booking.com emails as plain text, with the guest names
 * and reservation numbers replaced. The layout is what matters here.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(path.join(here, "__fixtures__", `${name}.txt`), "utf8");

test("bookingcom · claims Booking.com senders only", () => {
  assert.ok(handlesSender("Booking.com <noreply@booking.com>"));
  assert.ok(handlesSender("5400000002-rwqp.qudc@guest.booking.com"));
  assert.ok(handlesSender("5159691755-5nsm@property.booking.com"));
  assert.ok(!handlesSender("noreply@notbooking.com"));
  assert.ok(!handlesSender("alerts@icici.bank.in"));
});

test("bookingcom · a New booking! notice gives number, check-in and an assumed check-out", () => {
  const parsed = parseBookingComEmail(
    "Booking.com - New booking! (6400000001, Friday, 23 October 2026)",
    "noreply@booking.com",
    fixture("bdc-new-booking"),
  );
  assert.ok(parsed);
  assert.equal(parsed.kind, "notice");
  assert.equal(parsed.source, "bookingCom");
  assert.equal(parsed.externalRef, "6400000001");
  assert.equal(parsed.status, "confirmed");
  assert.equal(parsed.checkIn, "2026-10-23");
  assert.equal(parsed.checkOut, "2026-10-24");
  assert.equal(parsed.grossPaise, null);
});

test("bookingcom · Cancelled and Modified notices", () => {
  const cancelled = parseBookingComEmail(
    "Booking.com - Cancelled booking! (5451614967, Friday, 2 October 2026)",
    "noreply@booking.com",
    "",
  );
  assert.equal(cancelled?.status, "cancelled");
  assert.equal(cancelled?.checkIn, "2026-10-02");

  const modified = parseBookingComEmail(
    "Booking.com - Modified booking! (5159691755, Sunday, 23 August 2026)",
    "noreply@booking.com",
    "",
  );
  assert.equal(modified?.status, "confirmed");
  assert.equal(modified?.checkIn, "2026-08-23");
});

test("bookingcom · an auto-reply carries the full reservation", () => {
  const parsed = parseBookingComEmail(
    "RIYA SEN’s request has been confirmed",
    "noreply@booking.com",
    fixture("bdc-request-confirmed"),
  );
  assert.ok(parsed);
  assert.equal(parsed.kind, "details");
  assert.equal(parsed.externalRef, "6400000001");
  assert.equal(parsed.guestName, "Riya Sen");
  assert.equal(parsed.checkIn, "2026-10-23");
  assert.equal(parsed.checkOut, "2026-10-24");
  assert.equal(parsed.guests, 4);
});

test("bookingcom · a guest message carries the full reservation too", () => {
  const parsed = parseMessage({
    from: "5400000002-rwqp.qudc.zppf.vy4y@guest.booking.com",
    subject: "We received this message from Ghosh Anita",
    body: fixture("bdc-guest-message"),
  });
  assert.ok(parsed);
  assert.equal(parsed.parser.name, "Booking.com");
  assert.equal(parsed.voucher.kind, "details");
  assert.equal(parsed.voucher.guestName, "Ghosh Anita");
  assert.equal(parsed.voucher.checkIn, "2026-10-02");
  assert.equal(parsed.voucher.checkOut, "2026-10-04");
  assert.equal(parsed.voucher.guests, 5);
});

test("bookingcom · ignores mail that is not a reservation", () => {
  for (const subject of [
    "Booking.com - New message from Booking.com",
    "Modified contact information",
    "Booking disruption (6031783157): Please respond within 2 hours",
  ]) {
    assert.equal(parseBookingComEmail(subject, "noreply@booking.com", "Dear Property Partner, nothing here."), null, subject);
  }
});

test("bookingcom · notice check-out: feed first, then what is on file, else one night assumed", () => {
  assert.deepEqual(
    resolveNoticeCheckOut({ checkIn: "2026-10-23", calendarEnd: "2026-10-25", existingCheckOut: "2026-10-24" }),
    { checkOut: "2026-10-25", assumed: false },
  );
  assert.deepEqual(
    resolveNoticeCheckOut({ checkIn: "2026-10-23", calendarEnd: null, existingCheckOut: "2026-10-26" }),
    { checkOut: "2026-10-26", assumed: false },
  );
  assert.deepEqual(
    resolveNoticeCheckOut({ checkIn: "2026-10-23", calendarEnd: null, existingCheckOut: null }),
    { checkOut: "2026-10-24", assumed: true },
  );
  // A stale value before the new check-in is never kept.
  assert.deepEqual(
    resolveNoticeCheckOut({ checkIn: "2026-10-23", calendarEnd: "2026-10-20", existingCheckOut: "2026-10-22" }),
    { checkOut: "2026-10-24", assumed: true },
  );
});

test("bookingcom · Go-MMT mail still goes to the Go-MMT parser", () => {
  const hit = parseMessage({ from: "no-reply@goibibo.com", subject: "x", body: "" });
  assert.equal(hit, null);
});
