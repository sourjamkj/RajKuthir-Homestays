import test from "node:test";
import assert from "node:assert/strict";
import { acceptedQuoteMatches } from "./guest-booking-rules.ts";

test("accepts only the exact current total and advance", () => {
  assert.equal(
    acceptedQuoteMatches(
      { acceptedTotalPaise: 350000, acceptedAdvancePaise: 105000 },
      { totalPaise: 350000, advancePaise: 105000 },
    ),
    true,
  );
});

test("rejects a changed total or advance", () => {
  assert.equal(
    acceptedQuoteMatches(
      { acceptedTotalPaise: 350000, acceptedAdvancePaise: 105000 },
      { totalPaise: 360000, advancePaise: 108000 },
    ),
    false,
  );
  assert.equal(
    acceptedQuoteMatches(
      { acceptedTotalPaise: 350000, acceptedAdvancePaise: 105000 },
      { totalPaise: 350000, advancePaise: 110000 },
    ),
    false,
  );
});

test("rejects unsafe or fractional accepted amounts", () => {
  assert.equal(
    acceptedQuoteMatches(
      { acceptedTotalPaise: Number.MAX_SAFE_INTEGER + 1, acceptedAdvancePaise: 1 },
      { totalPaise: Number.MAX_SAFE_INTEGER + 1, advancePaise: 1 },
    ),
    false,
  );
  assert.equal(
    acceptedQuoteMatches(
      { acceptedTotalPaise: 100.5, acceptedAdvancePaise: 10 },
      { totalPaise: 100.5, advancePaise: 10 },
    ),
    false,
  );
});
