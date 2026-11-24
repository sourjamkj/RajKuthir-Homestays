import test from "node:test";
import assert from "node:assert/strict";
import { acceptedQuoteMatches, type AcceptedGuestQuote } from "./guest-booking-rules.ts";

const accepted: AcceptedGuestQuote = {
  checkIn: "2026-12-13",
  checkOut: "2026-12-15",
  adults: 2,
  children: 1,
  pets: 1,
  totalPaise: 350000,
  advancePaise: 105000,
};

test("accepts only an exact matching quote and party", () => {
  assert.equal(acceptedQuoteMatches(accepted, { ...accepted }), true);
});

test("rejects changed dates, guest counts, pets, total or advance", () => {
  const changes: AcceptedGuestQuote[] = [
    { ...accepted, checkIn: "2026-12-14" },
    { ...accepted, checkOut: "2026-12-16" },
    { ...accepted, adults: 3 },
    { ...accepted, children: 0 },
    { ...accepted, pets: 0 },
    { ...accepted, totalPaise: 360000 },
    { ...accepted, advancePaise: 108000 },
  ];
  for (const changed of changes) assert.equal(acceptedQuoteMatches(accepted, changed), false);
});

test("rejects fractional or unsafe monetary values", () => {
  assert.equal(acceptedQuoteMatches(accepted, { ...accepted, totalPaise: 350000.5 }), false);
  assert.equal(
    acceptedQuoteMatches(accepted, { ...accepted, totalPaise: Number.MAX_SAFE_INTEGER + 1 }),
    false,
  );
});
