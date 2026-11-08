import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_LADDER } from "./pricing.ts";
import { ladderTable, nextLadder, nextPeak, peakTable } from "./rate-edit-rules.ts";

const current = { ...DEFAULT_LADDER, weekdayBasePaise: 320_000, weekendBasePaise: 390_000, includedGuests: 2, extraGuestPaise: 35_000, floorPaise: 290_000 };

test("rate edit · the owner's sale ladder: ₹2,900 for two, +₹200 a guest, ₹3,500 for five", () => {
  const next = nextLadder(current, { weekdayBaseRupees: 2900, weekendBaseRupees: 2900, extraGuestRupees: 200 });
  assert.ok(next.ok);
  const table = ladderTable(next.ladder);
  assert.deepEqual(table["Sun–Thu"], { "1 guest": "₹2,900", "2 guests": "₹2,900", "3 guests": "₹3,100", "4 guests": "₹3,300", "5 guests": "₹3,500" });
  assert.deepEqual(table["Fri–Sat"], table["Sun–Thu"]);
  assert.equal(next.ladder.floorPaise, 290_000);
});

test("rate edit · only the fields given change; bad amounts refused", () => {
  const next = nextLadder(current, { extraGuestRupees: 200 });
  assert.ok(next.ok && next.ladder.weekdayBasePaise === 320_000 && next.ladder.extraGuestPaise === 20_000);
  assert.equal(nextLadder(current, { weekdayBaseRupees: -5 }).ok, false);
});

test("rate edit · a peak priced at ₹4,500 for five lands exactly, with the usual steps", () => {
  const ladder = { ...current, weekdayBasePaise: 290_000, weekendBasePaise: 290_000, extraGuestPaise: 20_000 };
  const made = nextPeak(null, { label: "Poush Mela", firstNight: "2026-12-23", lastNight: "2026-12-27", priceFor5GuestsRupees: 4500, minNights: 2 }, ladder, "p1");
  assert.ok(made.ok, JSON.stringify(made));
  assert.equal(made.peak.endDate, "2026-12-28");
  const table = peakTable(made.peak, ladder);
  assert.deepEqual(table.prices, { "1 guest": "₹3,900", "2 guests": "₹3,900", "3 guests": "₹4,100", "4 guests": "₹4,300", "5 guests": "₹4,500" });
});

test("rate edit · a new peak needs its label and nights", () => {
  assert.equal(nextPeak(null, { priceFor5GuestsRupees: 4500 }, current, "p").ok, false);
});
