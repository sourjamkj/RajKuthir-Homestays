import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CONVERSION_MESSAGES,
  advanceIsPaid,
  draftBookingFromEnquiry,
  type ConvertibleEnquiry,
} from "./enquiry-conversion.ts";

/**
 * Behavioural tests for enquiry -> booking conversion.
 *
 * The mapping is the whole point of the module and it decides what goes into
 * the calendar, so it is executed here rather than read. Run with:
 *   node --test src/lib/
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ENQUIRY_ROUTES_TS = readFileSync(path.join(here, "../routes/enquiries.ts"), "utf8");

function enquiryOf(over: Partial<ConvertibleEnquiry> = {}): ConvertibleEnquiry {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Reetuparna Bhattacharjee",
    phone: "+91 98041 43366",
    checkIn: "2026-11-10",
    checkOut: "2026-11-13",
    adults: 2,
    children: 2,
    pets: 1,
    requests: null,
    quotedTotalPaise: 4_500_000,
    quotedAdvancePaise: 1_350_000,
    advancePaidAt: new Date("2026-11-01T10:00:00Z"),
    convertedBookingId: null,
    ...over,
  };
}

function draftOf(over: Partial<ConvertibleEnquiry> = {}) {
  const result = draftBookingFromEnquiry(enquiryOf(over));
  assert.ok(result.ok, `expected a draft, got ${result.ok ? "" : result.reason}`);
  return result.draft;
}

// ================================================================== MAPPING

test("mapping · carries the guest, the dates and the pets across", () => {
  const draft = draftOf();
  assert.equal(draft.guestName, "Reetuparna Bhattacharjee");
  assert.equal(draft.guestPhone, "+91 98041 43366");
  assert.equal(draft.checkIn, "2026-11-10");
  assert.equal(draft.checkOut, "2026-11-13");
  assert.equal(draft.pets, 1);
});

test("mapping · a child counts as a guest", () => {
  // Two adults and two children are a party of four — the same rule party.ts
  // prices by. Counting adults alone would understate the stay.
  assert.equal(draftOf({ adults: 2, children: 2 }).guests, 4);
  assert.equal(draftOf({ adults: 2, children: 0 }).guests, 2);
  assert.equal(draftOf({ adults: 1, children: null }).guests, 1);
});

test("mapping · the source is direct, not manual", () => {
  // "manual" is for walk-ins and offline bookings. This came through the
  // website's own enquiry form and the ledger should be able to tell.
  assert.equal(draftOf().source, "direct");
});

test("mapping · quoted figures are carried, never recomputed", () => {
  const draft = draftOf();
  assert.equal(draft.grossPaise, 4_500_000, "the promise made to the guest must survive");
  assert.equal(draft.receivedPaise, 1_350_000);
});

test("mapping · an unquoted enquiry gets no invented price", () => {
  const draft = draftOf({ quotedTotalPaise: null, quotedAdvancePaise: null });
  assert.equal(draft.grossPaise, null, "a price was invented for an unquoted enquiry");
});

test("mapping · a direct booking pays no commission, and tax stays unknown", () => {
  const draft = draftOf();
  assert.equal(draft.commissionPaise, 0, "a direct booking has no channel commission");
  assert.equal(draft.taxPaise, null, "tax is not known at conversion time");
});

test("mapping · the note records the origin and keeps the guest's own words", () => {
  const draft = draftOf({ requests: "Arriving late, around 9pm" });
  assert.match(draft.note!, /Converted from website enquiry 11111111-/);
  assert.match(draft.note!, /Arriving late, around 9pm/);

  // And a note is still produced when the guest asked for nothing.
  assert.match(draftOf({ requests: null }).note!, /Converted from website enquiry/);
});

// ============================================================ PAID vs UNPAID

test("status · a paid enquiry becomes a confirmed booking", () => {
  assert.equal(draftOf().status, "confirmed");
  assert.equal(draftOf().receivedPaise, 1_350_000);
});

test("status · an unpaid enquiry becomes pending, and records no money in", () => {
  const draft = draftOf({ advancePaidAt: null });

  // findClashes only counts confirmed bookings, so a pending row deliberately
  // does not close the dates on the strength of an unpaid promise.
  assert.equal(draft.status, "pending");
  assert.equal(draft.receivedPaise, null, "money was recorded that never arrived");

  // The quoted total still stands — it was promised, whether or not it is paid.
  assert.equal(draft.grossPaise, 4_500_000);
});

test("status · advanceIsPaid is not fooled by a string or a bad date", () => {
  assert.equal(advanceIsPaid(new Date("2026-11-01T10:00:00Z")), true);
  assert.equal(advanceIsPaid("2026-11-01T10:00:00Z"), true, "an ISO string is a real payment");
  assert.equal(advanceIsPaid(null), false);
  assert.equal(advanceIsPaid("not a date"), false, "an unparseable value must not confirm a booking");
});

// ================================================================= REFUSALS

test("refusal · an already-converted enquiry is refused, not converted twice", () => {
  const result = draftBookingFromEnquiry(
    enquiryOf({ convertedBookingId: "22222222-2222-4222-8222-222222222222" }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "already_converted");
});

test("refusal · missing or unusable dates", () => {
  for (const [over, reason] of [
    [{ checkIn: null }, "no_dates"],
    [{ checkOut: null }, "no_dates"],
    [{ checkIn: "10-11-2026" }, "dates_unreadable"],
    [{ checkIn: "2026-11-13", checkOut: "2026-11-13" }, "not_a_stay"],
    [{ checkIn: "2026-11-14", checkOut: "2026-11-13" }, "not_a_stay"],
  ] as const) {
    const result = draftBookingFromEnquiry(enquiryOf(over));
    assert.equal(result.ok, false, `${JSON.stringify(over)} should have been refused`);
    assert.equal(result.ok === false && result.reason, reason);
  }
});

test("refusal · no guests means no booking", () => {
  const result = draftBookingFromEnquiry(enquiryOf({ adults: 0, children: 0 }));
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "no_guest_count");

  const nulls = draftBookingFromEnquiry(enquiryOf({ adults: null, children: null }));
  assert.equal(nulls.ok, false);
});

test("refusal · every reason has a message the owner can act on", () => {
  for (const reason of [
    "already_converted",
    "no_dates",
    "dates_unreadable",
    "not_a_stay",
    "no_guest_count",
  ] as const) {
    const message = CONVERSION_MESSAGES[reason];
    assert.ok(message && message.length > 10, `${reason} has no usable message`);
    assert.ok(/[.!]$/.test(message), `${reason}'s message is not a sentence`);
  }
});

// ===================================================== THE ROUTE'S GUARANTEES

test("route · re-checks availability at conversion time, not enquiry time", () => {
  // An enquiry can sit for days between the form and the advance landing, and
  // an OTA booking may have taken the same nights in between.
  const body = ENQUIRY_ROUTES_TS.slice(
    ENQUIRY_ROUTES_TS.indexOf('router.post("/enquiries/:id/convert"'),
  ).slice(0, 4000);

  assert.ok(body.length > 0, "the convert route was not found");
  assert.match(body, /await findClashes\(\{/, "the convert route does not re-check the dates");
  assert.ok(
    body.indexOf("findClashes") < body.indexOf("createBooking"),
    "the clash check must happen before the booking is created",
  );
  assert.match(body, /res\.status\(409\)/, "a clash must refuse, not overwrite");
});

test("route · links the enquiry to the booking so it cannot convert twice", () => {
  const body = ENQUIRY_ROUTES_TS.slice(
    ENQUIRY_ROUTES_TS.indexOf('router.post("/enquiries/:id/convert"'),
  ).slice(0, 4000);

  assert.match(body, /await linkEnquiryToBooking\(id, booking\.id\)/);
  assert.ok(
    body.indexOf("createBooking") < body.indexOf("linkEnquiryToBooking"),
    "the link must be written after the booking exists",
  );
});

test("route · does not let the reference be supplied from outside", () => {
  // createBooking issues the RK- code. A caller-supplied reference would let a
  // request choose a code that has already been sent to a different guest.
  const body = ENQUIRY_ROUTES_TS.slice(
    ENQUIRY_ROUTES_TS.indexOf('router.post("/enquiries/:id/convert"'),
  ).slice(0, 4000);

  assert.ok(
    !/reference:\s*(req\.body|body\.)/.test(body),
    "the convert route accepts a reference from the request body",
  );
});

test("route · keeps guest name and phone out of the logs", () => {
  const body = ENQUIRY_ROUTES_TS.slice(
    ENQUIRY_ROUTES_TS.indexOf('router.post("/enquiries/:id/convert"'),
  ).slice(0, 4000);

  const logLines = body.match(/logger\.(info|warn|error)\([\s\S]*?\)/g) ?? [];
  assert.ok(logLines.length > 0, "the convert route logs nothing at all");
  for (const line of logLines) {
    for (const leak of ["guestName", "guestPhone", "enquiry.name", "enquiry.phone"]) {
      assert.ok(!line.includes(leak), `a log line carries ${leak}`);
    }
  }
});
