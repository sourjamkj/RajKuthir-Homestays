import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FESTIVAL_PLACEHOLDER, RATES_PLACEHOLDER, festivalLine, ratesLine, withRateFacts } from "./rate-facts.ts";
import { DEFAULT_LADDER, nightPrice } from "./pricing.ts";
import type { RatePlan } from "./rates-repo.ts";

const ladder = { ...DEFAULT_LADDER, weekdayBasePaise: 290_000, weekendBasePaise: 290_000, includedGuests: 2, extraGuestPaise: 20_000, floorPaise: 290_000 };
const rates = { 1: 290_000, 2: 290_000, 3: 310_000, 4: 330_000, 5: 350_000 };
const plan: RatePlan = {
  rates, weekendRates: rates, ladder, overrides: [], maxGuests: 5,
  peaks: [{ id: "poush-mela-2026", label: "Poush Mela", startDate: "2026-12-23", endDate: "2026-12-28", bookingComPaise: 487_500, discountPercent: 20, minNights: 2 }],
};

const price = (p: RatePlan, night: string, guests: number) => nightPrice(p.ladder, p.peaks, night, guests);

test("rates line names every party size and says when all nights cost the same", () => {
  const line = ratesLine(plan);
  assert.match(line, /every night of the week/);
  assert.match(line, /₹2,900 for 1–2 guests, ₹3,100 for 3 guests, ₹3,300 for 4 guests, ₹3,500 for 5 guests/);
  assert.match(ratesLine({ ...plan, weekendRates: { ...rates, 2: 320_000 } }), /Friday and Saturday/);
});

test("festival line gives the nights, the minimum stay and a price", () => {
  const line = festivalLine(plan, "poush-mela", "2026-11-10", price)!;
  assert.match(line, /23 December 2026 to 27 December 2026/);
  assert.match(line, /Minimum stay: 2 nights/);
  assert.match(line, /₹4,500 a night, one price for up to 5 guests/);
  assert.equal(festivalLine(plan, "poush-mela", "2027-01-05", price), null);
  assert.equal(festivalLine(plan, "basanta-utsav", "2026-11-10", price), null);
});

test("only the right page's loading line is replaced, and nothing without a plan", () => {
  const html = `<p>${RATES_PLACEHOLDER}</p><p>${FESTIVAL_PLACEHOLDER}</p>`;
  assert.ok(!withRateFacts(html, "/rates", plan, "2026-11-10", price).includes(RATES_PLACEHOLDER));
  assert.ok(withRateFacts(html, "/rates", plan, "2026-11-10", price).includes(FESTIVAL_PLACEHOLDER));
  assert.ok(!withRateFacts(html, "/poush-mela-stay-shantiniketan", plan, "2026-11-10", price).includes(FESTIVAL_PLACEHOLDER));
  assert.equal(withRateFacts(html, "/gallery", plan, "2026-11-10", price), html);
  assert.equal(withRateFacts(html, "/rates", null, "2026-11-10", price), html);
});

test("the placeholders are the exact words the pages render", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  assert.ok(read("../../../raj-kuthir/src/pages/Rates.tsx").includes("Loading the current rate card&hellip;"));
  assert.ok(read("../../../raj-kuthir/src/components/FestivalStay.tsx").includes("Reading this year&rsquo;s dates and rates&hellip;"));
});
