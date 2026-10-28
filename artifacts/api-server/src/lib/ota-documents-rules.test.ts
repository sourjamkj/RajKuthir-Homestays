import { test } from "node:test";
import assert from "node:assert/strict";

import { bookingRefOf, fileDocument, kindOf, otaSourceOf, periodOf } from "./ota-documents-rules.ts";

test("OTA senders are recognised; anyone else is not", () => {
  assert.equal(otaSourceOf("no-reply@go-mmt.com"), "makeMyTrip");
  assert.equal(otaSourceOf("no-reply@goibibo.com"), "makeMyTrip");
  assert.equal(otaSourceOf("feedback@zen2-makemytrip.com"), "makeMyTrip");
  assert.equal(otaSourceOf("noreply@booking.com"), "bookingCom");
  assert.equal(otaSourceOf("6594963454-awzp.2nn6@guest.booking.com"), "bookingCom");
  assert.equal(otaSourceOf("automated@airbnb.com"), "airbnb");
  assert.equal(otaSourceOf("alerts@icici.bank.in"), null);
  assert.equal(otaSourceOf("someone@notbooking.com"), null);
});

test("kinds from the subject", () => {
  assert.equal(kindOf("New Booking Received for Raj Kuthir Homestays - Sobuj Potro on GoIbibo - GH75201277825410"), "voucher");
  assert.equal(kindOf("Cancellation received for Booking ID : NH74000510958782"), "cancellation");
  assert.equal(kindOf("Commission Income for the month of Oct 2026"), "statement");
});

test("booking numbers from the subject", () => {
  assert.equal(bookingRefOf("New Booking Received ... on MakeMyTrip - NH70009512935390"), "NH70009512935390");
  assert.equal(bookingRefOf("Cancellation received for Booking ID : GH75081277131254"), "GH75081277131254");
  assert.equal(bookingRefOf("Booking.com - New booking! (6594963454, Saturday, 26 December 2026)"), "6594963454");
  assert.equal(bookingRefOf("Commission Income for the month of Oct 2026"), null);
});

test("statement month", () => {
  assert.equal(periodOf("Commission Income for the month of Oct 2026"), "2026-10");
  assert.equal(periodOf("Statement for September 2026"), "2026-09");
  assert.equal(periodOf("New booking"), null);
});

test("filing: statements carry a month, bookings carry a reference", () => {
  assert.deepEqual(fileDocument({ from: "feedback@zen2-makemytrip.com", subject: "Commission Income for the month of Aug 2026" }), {
    source: "makeMyTrip", kind: "statement", externalRef: null, period: "2026-08",
  });
  assert.deepEqual(fileDocument({ from: "no-reply@go-mmt.com", subject: "New Booking Received ... - NH70154505593914" }), {
    source: "makeMyTrip", kind: "voucher", externalRef: "NH70154505593914", period: null,
  });
  assert.equal(fileDocument({ from: "friend@gmail.com", subject: "Booking 1234567890" }), null);
});
