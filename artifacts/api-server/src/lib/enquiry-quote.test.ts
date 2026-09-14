import assert from "node:assert/strict";
import test from "node:test";

import {
  ADVANCE_PERCENT,
  advanceOf,
  quoteForEnquiry,
  type PriceStay,
} from "./enquiry-quote.ts";

/**
 * These numbers end up in a WhatsApp message asking a stranger to send money.
 * A wrong one is not a visual glitch — it is either a guest overcharged or a
 * night given away, and it cannot be recalled once sent. So the arithmetic is
 * pinned here rather than trusted.
 */

/** A stand-in rate plan: ₹2,000 a night for one, ₹800 more per extra head. */
const priceStay: PriceStay = (checkIn, checkOut, guests) => {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  const nights = Math.max(0, Math.round((end - start) / 86_400_000));
  const perNight = 200_000 + (guests - 1) * 80_000;
  return { nights, totalPaise: nights * perNight };
};

const base = {
  checkIn: "2026-10-02",
  checkOut: "2026-10-05",
  adults: 2,
  children: 0,
};

test("quote · prices the nights between check-in and check-out", () => {
  const result = quoteForEnquiry(base, priceStay);

  assert.ok(result.ok);
  // Three nights — the 2nd, 3rd and 4th. Check-out day is not a night.
  assert.equal(result.nights, 3);
  assert.equal(result.guests, 2);
  assert.equal(result.totalPaise, 3 * 280_000);
});

test("quote · children are counted as guests for occupancy", () => {
  const family = quoteForEnquiry(
    { ...base, adults: 2, children: 2 },
    priceStay,
  );
  const couple = quoteForEnquiry(base, priceStay);

  assert.ok(family.ok && couple.ok);
  assert.equal(family.guests, 4);
  assert.ok(
    family.totalPaise > couple.totalPaise,
    "a family of four was priced the same as a couple",
  );
});

test("quote · the advance is half, and the balance is the rest exactly", () => {
  const result = quoteForEnquiry(base, priceStay);

  assert.ok(result.ok);
  assert.equal(ADVANCE_PERCENT, 50);
  assert.equal(result.advancePaise, result.totalPaise / 2);
  // The two parts must reconstruct the whole. If rounding ever breaks this,
  // a guest pays a rupee more or less than the stay costs.
  assert.equal(
    result.advancePaise + result.balancePaise,
    result.totalPaise,
    "advance plus balance did not equal the total",
  );
});

test("quote · an odd total rounds the advance up to a whole rupee", () => {
  // ₹2,999.01 — half is ₹1,499.505, which must not reach a guest.
  assert.equal(advanceOf(299_901), 150_000);
  assert.equal(advanceOf(299_901) % 100, 0, "advance was not a whole rupee");

  const odd: PriceStay = () => ({ nights: 1, totalPaise: 299_901 });
  const result = quoteForEnquiry(base, odd);

  assert.ok(result.ok);
  assert.equal(result.advancePaise, 150_000);
  assert.equal(result.balancePaise, 149_901);
  assert.equal(result.advancePaise + result.balancePaise, 299_901);
});

test("quote · an exact total is not rounded up a rupee", () => {
  // Guards the obvious Math.ceil bug: 50% of ₹4,000 is ₹2,000, not ₹2,000.01.
  assert.equal(advanceOf(400_000), 200_000);
});

test("quote · an enquiry with no dates is refused, with a reason", () => {
  for (const missing of [
    { ...base, checkIn: null },
    { ...base, checkOut: null },
  ]) {
    const result = quoteForEnquiry(missing, priceStay);
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /dates/i);
  }
});

test("quote · check-out on or before check-in is refused", () => {
  for (const bad of ["2026-10-02", "2026-10-01"]) {
    const result = quoteForEnquiry({ ...base, checkOut: bad }, priceStay);
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /check-out/i);
  }
});

test("quote · no guest count is refused rather than assumed", () => {
  const result = quoteForEnquiry(
    { ...base, adults: null, children: null },
    priceStay,
  );

  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /guest count/i);
});

test("quote · an unpriced occupancy is refused, naming the occupancy", () => {
  // A rate plan with nothing set for this many guests returns zero. Sending
  // "₹0" would be worse than sending nothing.
  const unpriced: PriceStay = (_in, _out, _guests) => ({
    nights: 3,
    totalPaise: 0,
  });

  const result = quoteForEnquiry({ ...base, adults: 9 }, unpriced);

  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /9 guests/);
});

test("quote · a malformed date is refused, not parsed loosely", () => {
  const result = quoteForEnquiry(
    { ...base, checkIn: "02-10-2026" },
    priceStay,
  );

  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /not readable/i);
});
