import assert from "node:assert/strict";
import test from "node:test";

import { buildEnquiryFollowUp, isReturningGuest } from "./enquiry-followup.ts";
import type { QuoteResult } from "./enquiry-quote.ts";

const NOW = new Date("2026-11-03T08:00:00Z");
const sourav = {
  name: "Sourav Das",
  checkIn: "2026-11-06",
  checkOut: "2026-11-11",
  adults: 3,
  children: 0,
  pets: 2,
  status: "new" as const,
  createdAt: "2026-11-03T07:55:00Z",
  quoteSentAt: null,
};
// The live quote for this enquiry: 5 nights, 3 guests, 2 dogs.
const quote: QuoteResult = {
  ok: true,
  checkIn: "2026-11-06",
  checkOut: "2026-11-11",
  nights: 5,
  guests: 3,
  breakdown: { heads: 3, ratedGuests: 3, extraChildren: 0, extraAdults: 0, pets: 2 },
  roomPaise: 1_915_000,
  extraGuestPaise: 0,
  petPaise: 375_000,
  totalPaise: 2_290_000,
  advancePaise: 1_145_000,
  balancePaise: 1_145_000,
  advancePercent: 50,
  peak: null,
};

test("follow-up · a returning guest with dates and party gets the price, not questions", () => {
  const text = buildEnquiryFollowUp(sourav, { quote, datesTaken: null, returning: true, now: NOW });
  assert.match(text, /^Hi Sourav, welcome back/);
  assert.match(text, /• Check-in: Fri, 6 Nov, from 12 noon/);
  assert.match(text, /• Check-out: Wed, 11 Nov, by 11 am/);
  assert.match(text, /• Stay: 5 nights for 3 guests: ₹19,150/);
  assert.match(text, /• 2 pets: ₹3,750/);
  assert.match(text, /• Total: ₹22,900/);
  assert.doesNotMatch(text, /website!|how many of you/i);
});

test("follow-up · never says the guest enquired on our website", () => {
  for (const row of [sourav, { ...sourav, adults: null, pets: null }, { ...sourav, checkIn: null, checkOut: null }]) {
    const text = buildEnquiryFollowUp(row, { quote, datesTaken: null, returning: false, now: NOW });
    assert.doesNotMatch(text, /on our website/);
  }
});

test("follow-up · asks for the party only when it is missing", () => {
  const unknown = buildEnquiryFollowUp({ ...sourav, adults: null, children: null, pets: null }, { quote, datesTaken: null, returning: false, now: NOW });
  assert.match(unknown, /How many of you are coming/);
  assert.match(unknown, /Thank you for getting in touch!/);
});

test("follow-up · taken dates and a sent quote keep their own replies", () => {
  const taken = buildEnquiryFollowUp(sourav, { quote, datesTaken: { startDate: "2026-11-06", endDate: "2026-11-08" }, returning: true, now: NOW });
  assert.match(taken, /already booked for 6 Nov – 11 Nov/);
  const nudge = buildEnquiryFollowUp({ ...sourav, status: "contacted", quoteSentAt: "2026-11-03T08:00:00Z" }, { quote, datesTaken: null, returning: false, now: NOW });
  assert.match(nudge, /following up on the quote we sent for 6 Nov – 11 Nov/);
});

test("follow-up · a late first reply apologises", () => {
  const late = buildEnquiryFollowUp({ ...sourav, createdAt: "2026-11-01T08:00:00Z" }, { quote, datesTaken: null, returning: false, now: NOW });
  assert.match(late, /Sorry we did not get back sooner/);
});

test("returning guest · a past stay or the owner's tag", () => {
  assert.equal(isReturningGuest({ stays: 0, lastStay: null, tags: "Repeat guest" }, "2026-11-03"), true);
  assert.equal(isReturningGuest({ stays: 1, lastStay: "2025-10-18", tags: null }, "2026-11-03"), true);
  assert.equal(isReturningGuest({ stays: 1, lastStay: "2026-12-01", tags: null }, "2026-11-03"), false);
  assert.equal(isReturningGuest(undefined, "2026-11-03"), false);
});
