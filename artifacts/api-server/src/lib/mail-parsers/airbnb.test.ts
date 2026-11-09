import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { handlesSender, inferYear, parseAirbnbEmail } from "./airbnb.ts";
import { parseMessage } from "./index.ts";

/** A real Airbnb host confirmation as plain text, with the guest's name and code replaced. */
const here = path.dirname(fileURLToPath(import.meta.url));
const confirmed = readFileSync(path.join(here, "__fixtures__", "airbnb-confirmed.txt"), "utf8");
const NOW = new Date("2026-11-09T13:30:00Z");

test("airbnb · claims Airbnb senders only", () => {
  assert.ok(handlesSender("Airbnb <automated@airbnb.com>"));
  assert.ok(handlesSender("express@airbnb.co.in"));
  assert.ok(!handlesSender("noreply@booking.com"));
  assert.ok(!handlesSender("someone@notairbnb.com"));
});

test("airbnb · a confirmed reservation gives code, dates, party, pets and money", () => {
  const parsed = parseAirbnbEmail("Reservation confirmed - Riya Sen arrives Nov 21", "automated@airbnb.com", confirmed, NOW);
  assert.ok(parsed);
  assert.equal(parsed.source, "airbnb");
  assert.equal(parsed.externalRef, "HMTEST1234");
  assert.equal(parsed.status, "confirmed");
  assert.equal(parsed.guestName, "Riya Sen");
  assert.equal(parsed.checkIn, "2026-11-21");
  assert.equal(parsed.checkOut, "2026-11-22");
  assert.equal(parsed.guests, 4);
  assert.equal(parsed.pets, 3);
  assert.equal(parsed.grossPaise, 612_360);
  assert.equal(parsed.commissionPaise, 90_396);
  assert.equal(parsed.receivedPaise, 492_804);
  assert.equal(parsed.kind, undefined);
});

test("airbnb · goes through the shared pipeline", () => {
  const hit = parseMessage({ from: "Airbnb <automated@airbnb.com>", subject: "Reservation confirmed - Riya Sen arrives Nov 21", body: confirmed });
  assert.ok(hit);
  assert.equal(hit.parser.name, "Airbnb");
  assert.equal(hit.voucher.externalRef, "HMTEST1234");
});

test("airbnb · a cancellation is saved as cancelled with no money", () => {
  const parsed = parseAirbnbEmail("Canceled: Reservation HMTEST1234 for Nov 21 – 22", "automated@airbnb.com", "Reservation canceled\n\nCheck-in Checkout\n\nSat, Nov 21 Sun, Nov 22\n", NOW);
  assert.ok(parsed);
  assert.equal(parsed.status, "cancelled");
  assert.equal(parsed.externalRef, "HMTEST1234");
  assert.equal(parsed.grossPaise, null);
});

test("airbnb · other Airbnb mail (messages, payouts) is ignored", () => {
  assert.equal(parseAirbnbEmail("New message from Riya", "automated@airbnb.com", "Hi! See you soon", NOW), null);
  assert.equal(parseAirbnbEmail("We sent a payout", "express@airbnb.com", "₹4,928.04 is on its way", NOW), null);
});

test("airbnb · the year is never more than 60 days back, and a New Year stay rolls over", () => {
  assert.equal(inferYear(11, 21, NOW), "2026-11-21");
  assert.equal(inferYear(1, 2, NOW), "2027-01-02");
  assert.equal(inferYear(10, 1, NOW), "2026-10-01");
  const ny = parseAirbnbEmail("Reservation confirmed - A B arrives Dec 31", "automated@airbnb.com", "CONFIRMATION CODE\nHMNEWYEAR1\nCheck-in Checkout\n\nThu, Dec 31 Sat, Jan 2\nGUESTS\n\n2 adults\n", NOW);
  assert.ok(ny);
  assert.equal(ny.checkIn, "2026-12-31");
  assert.equal(ny.checkOut, "2027-01-02");
  assert.equal(ny.pets, 0);
});
