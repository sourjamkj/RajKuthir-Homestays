import assert from "node:assert/strict";
import test from "node:test";
import {
  arrivalAt,
  csvCell,
  formCDueAt,
  formCState,
  isForeignNationality,
  readFeedback,
  readPeriod,
  registerCells,
  toCsv,
  type RegisterRow,
} from "./compliance-rules.ts";

test("compliance · India in any usual spelling is not foreign; blank is unknown", () => {
  for (const value of ["India", " india ", "IN", "Bharat", "Indian", "Republic of India"]) {
    assert.equal(isForeignNationality(value), false, value);
  }
  assert.equal(isForeignNationality("Bangladesh"), true);
  assert.equal(isForeignNationality("United Kingdom"), true);
  assert.equal(isForeignNationality(""), null);
  assert.equal(isForeignNationality(null), null);
});

test("compliance · Form C is due from noon IST on arrival day until 24 hours later", () => {
  assert.equal(arrivalAt("2026-12-26").toISOString(), "2026-12-26T06:30:00.000Z");
  assert.equal(formCDueAt("2026-12-26").toISOString(), "2026-12-27T06:30:00.000Z");
  const base = { country: "Germany", checkIn: "2026-12-26", filedAt: null };
  assert.equal(formCState({ ...base, now: new Date("2026-12-26T06:00:00Z") }), "upcoming");
  assert.equal(formCState({ ...base, now: new Date("2026-12-26T10:00:00Z") }), "due");
  assert.equal(formCState({ ...base, now: new Date("2026-12-27T07:00:00Z") }), "overdue");
  assert.equal(formCState({ ...base, filedAt: new Date(), now: new Date("2026-12-28T00:00:00Z") }), "filed");
  assert.equal(formCState({ ...base, country: "India", now: new Date("2026-12-28T00:00:00Z") }), "not_needed");
  assert.equal(formCState({ ...base, country: null, now: new Date("2026-12-28T00:00:00Z") }), "unknown");
});

const row = (over: Partial<RegisterRow>): RegisterRow => ({
  bookingId: "b1",
  reference: "RK-26DEC-ABCDE",
  source: "bookingCom",
  status: "confirmed",
  checkIn: "2026-12-26",
  checkOut: "2026-12-28",
  bookingName: "Booking Name",
  bookingPhone: "+91 90000 00000",
  guests: 3,
  pets: 0,
  guestName: null,
  guestPhone: null,
  address: null,
  city: null,
  state: null,
  country: null,
  documentTypes: [],
  formCFiledAt: null,
  formCReference: null,
  ...over,
});

test("compliance · register: oldest first, cancelled left out, guest's own details win", () => {
  const cells = registerCells(
    [
      row({ checkIn: "2027-01-02", checkOut: "2027-01-05", reference: "B" }),
      row({ status: "cancelled", reference: "X" }),
      row({
        reference: "A",
        guestName: "Asha Roy",
        guestPhone: "+91 98300 00000",
        address: "12 Lake Road",
        city: "Kolkata",
        state: "West Bengal",
        country: "India",
        documentTypes: ["Aadhaar", "Aadhaar", "Passport"],
        pets: 2,
      }),
    ],
    new Date("2026-12-27T00:00:00Z"),
  );
  assert.equal(cells.length, 2);
  assert.deepEqual(cells[0], [
    "1",
    "A",
    "26-12-2026",
    "28-12-2026",
    "2",
    "Asha Roy",
    "+91 98300 00000",
    "12 Lake Road, Kolkata, West Bengal",
    "India",
    "3",
    "2",
    "Aadhaar; Passport",
    "Not needed (Indian)",
    "Booking.com",
  ]);
  assert.equal(cells[1]?.[1], "B");
  assert.equal(cells[1]?.[5], "Booking Name");
  assert.equal(cells[1]?.[11], "Not uploaded");
  assert.equal(cells[1]?.[12], "Nationality not given");
});

test("compliance · CSV cells are quoted and formula-safe, phone numbers untouched", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a, b"), '"a, b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell("-x"), "'-x");
  assert.equal(csvCell("+91 98300 00000"), "+91 98300 00000");
  assert.ok(toCsv([["a"], ["b"]]).startsWith("﻿a\r\nb"));
});

test("compliance · period must be real dates in order", () => {
  assert.deepEqual(readPeriod(undefined, undefined), { from: null, to: null });
  assert.deepEqual(readPeriod("2026-11-01", "2026-11-30"), { from: "2026-11-01", to: "2026-11-30" });
  assert.equal(readPeriod("2026-11-30", "2026-11-01"), null);
  assert.equal(readPeriod("1/11/2026", undefined), null);
});

test("compliance · feedback form: honeypot, kind, name and message are checked", () => {
  assert.deepEqual(readFeedback({ website: "http://spam", kind: "complaint", name: "Bot", message: "x".repeat(20) }), { ok: "bot" });
  assert.equal(readFeedback({ kind: "rant", name: "Asha", message: "The geyser was cold." }).ok, false);
  assert.equal(readFeedback({ kind: "complaint", name: "A", message: "The geyser was cold." }).ok, false);
  assert.equal(readFeedback({ kind: "complaint", name: "Asha", message: "cold" }).ok, false);
  const good = readFeedback({ kind: "suggestion", name: "  Asha  Roy ", contact: "", stayRef: "RK-1", message: "A kettle in the room would help." });
  assert.equal(good.ok, true);
  if (good.ok === true) {
    assert.equal(good.value.name, "Asha Roy");
    assert.equal(good.value.contact, null);
    assert.equal(good.value.stayRef, "RK-1");
  }
});
