import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseGoMmtVoucher } from "./gomt.ts";

/**
 * Fixtures are the real emails, kept verbatim.
 *
 * Go-MMT's plain-text conversion is not stable — booking-oct arrives as
 * pipe-delimited table rows, booking-aug as flowing prose with the same fields
 * in the same order. Both are here deliberately: when the layout changes again,
 * this is what tells us, instead of a silently missed booking.
 *
 * Run with:  node --test src/lib/mail-parsers/
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(path.join(here, "__fixtures__", `${name}.txt`), "utf8");

const FROM = "no-reply@goibibo.com";

test("parses a pipe-table voucher", () => {
  const parsed = parseGoMmtVoucher(
    "New Booking Received for Raj Kuthir Homestays - Sobuj Potro on GoIbibo - GH75081277131254",
    FROM,
    fixture("booking-oct"),
  );

  assert.ok(parsed);
  assert.equal(parsed.externalRef, "GH75081277131254");
  assert.equal(parsed.status, "confirmed");
  assert.equal(parsed.guestName, "Sudipta Saha");
  assert.equal(parsed.checkIn, "2026-10-02");
  assert.equal(parsed.checkOut, "2026-10-04");
  assert.equal(parsed.guests, 3);
  assert.equal(parsed.grossPaise, 426_600);
  assert.equal(parsed.commissionPaise, 90_610);
  assert.equal(parsed.taxPaise, 427);
  assert.equal(parsed.receivedPaise, 335_563);
});

test("parses the same fields from the flowing-prose layout", () => {
  const parsed = parseGoMmtVoucher(
    "New Booking Received for Raj Kuthir Homestays - Sobuj Potro on GoIbibo - GH77048275079618",
    FROM,
    fixture("booking-aug"),
  );

  assert.ok(parsed);
  assert.equal(parsed.externalRef, "GH77048275079618");
  assert.equal(parsed.guestName, "Somnath Sarkar");
  assert.equal(parsed.checkIn, "2026-08-12");
  assert.equal(parsed.checkOut, "2026-08-13");
  assert.equal(parsed.guests, 2);
  assert.equal(parsed.grossPaise, 232_210);
  assert.equal(parsed.receivedPaise, 182_656);
});

test("a cancellation flips the status and reports no money", () => {
  const parsed = parseGoMmtVoucher(
    "Cancellation received for Booking ID : GH75081277131254",
    FROM,
    fixture("cancel-oct"),
  );

  assert.ok(parsed);
  assert.equal(parsed.externalRef, "GH75081277131254");
  assert.equal(parsed.status, "cancelled");

  // The cancellation voucher carries "Cancellation Charges (Payable to
  // Property) ₹ 0.0". Reading that as the amount received would zero out a
  // payment already recorded, so every money field is deliberately null and
  // the sync leaves the stored figures alone.
  assert.equal(parsed.grossPaise, null);
  assert.equal(parsed.commissionPaise, null);
  assert.equal(parsed.taxPaise, null);
  assert.equal(parsed.receivedPaise, null);

  // Dates still parse, so the row can be matched to the booking it cancels.
  assert.equal(parsed.checkIn, "2026-10-02");
  assert.equal(parsed.checkOut, "2026-10-04");
});

test("ignores mail from any other sender", () => {
  const parsed = parseGoMmtVoucher(
    "New Booking",
    "noreply@airbnb.com",
    "Booking ID AB123456789012 12 Aug '26 13 Aug '26",
  );

  assert.equal(parsed, null);
});

test("ignores Go-MMT mail that is not a voucher", () => {
  const parsed = parseGoMmtVoucher(
    "Commission Income for the month of Aug 2026",
    "feedback@zen2-makemytrip.com",
    "Dear Partner, Please find attached the commission statement.",
  );

  assert.equal(parsed, null);
});
