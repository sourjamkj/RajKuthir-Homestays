import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_LADDER,
  DEFAULT_PEAKS,
  applyWeeklyDiscount,
  isWeekendNight,
  ladderProblem,
  minimumStayFor,
  nightPrice,
  peakProblem,
  type PeakPeriod,
} from "./pricing.ts";

const L = DEFAULT_LADDER;
const THU = "2026-10-15";
const FRI = "2026-10-16";
const SAT = "2026-10-17";
const SUN = "2026-10-18";

test("weekend is Friday and Saturday nights only", () => {
  assert.equal(isWeekendNight(THU), false);
  assert.equal(isWeekendNight(FRI), true);
  assert.equal(isWeekendNight(SAT), true);
  assert.equal(isWeekendNight(SUN), false);
});

test("ladder: ₹3,200 weekday / ₹3,900 weekend for 1–2, +₹350 per guest to 5", () => {
  assert.equal(nightPrice(L, [], THU, 1), 320_000);
  assert.equal(nightPrice(L, [], THU, 2), 320_000);
  assert.equal(nightPrice(L, [], THU, 3), 355_000);
  assert.equal(nightPrice(L, [], THU, 5), 425_000);
  assert.equal(nightPrice(L, [], SAT, 2), 390_000);
  assert.equal(nightPrice(L, [], SAT, 5), 495_000);
  // The ladder stops at five; party.ts prices anyone beyond.
  assert.equal(nightPrice(L, [], THU, 8), 425_000);
});

const PEAK: PeakPeriod = {
  ...DEFAULT_PEAKS[0]!,
  bookingComPaise: 600_000,
};

test("peak night is 10% below the Booking.com rate, extra guests on top", () => {
  assert.equal(nightPrice(L, [PEAK], "2026-12-24", 2), 540_000);
  assert.equal(nightPrice(L, [PEAK], "2026-12-24", 4), 610_000);
  // Range is half-open: Sat 2 Jan is the first night after the period.
  assert.equal(nightPrice(L, [PEAK], "2027-01-01", 2), 540_000);
  assert.equal(nightPrice(L, [PEAK], "2027-01-02", 2), 390_000);
});

test("a peak with no Booking.com rate yet keeps the normal rate — never a discount off a guess", () => {
  assert.equal(nightPrice(L, DEFAULT_PEAKS, "2026-12-24", 2), 320_000); // Thu
  assert.equal(nightPrice(L, DEFAULT_PEAKS, "2026-12-26", 2), 390_000); // Sat
});

test("floor: nothing goes below ₹2,900 — not a cheap peak, not an old -% rule", () => {
  const cheapPeak = { ...PEAK, bookingComPaise: 250_000 };
  assert.equal(nightPrice(L, [cheapPeak], "2026-12-24", 2), 290_000);
  assert.equal(nightPrice(L, [], THU, 2, (p) => p * 0.5), 290_000);
});

test("weekly discount: 10% off each night from 7 nights, floor held per night", () => {
  const six = Array(6).fill(320_000);
  assert.deepEqual(applyWeeklyDiscount(L, six), six);

  const seven = [320_000, 320_000, 390_000, 390_000, 320_000, 320_000, 320_000];
  assert.deepEqual(applyWeeklyDiscount(L, seven), [
    290_000, 290_000, 351_000, 351_000, 290_000, 290_000, 290_000,
  ]);
});

test("peak minimum stay names the period; quiet dates need nothing", () => {
  assert.deepEqual(minimumStayFor(DEFAULT_PEAKS, ["2026-12-31"]), {
    minNights: 2,
    label: "Poush Mela, Christmas & New Year",
  });
  assert.equal(minimumStayFor(DEFAULT_PEAKS, [THU, FRI]), null);
});

test("validation: weekly discount capped at 10%, bases cannot sit under the floor", () => {
  assert.equal(ladderProblem(L), null);
  assert.match(ladderProblem({ ...L, weeklyDiscountPercent: 15 }) ?? "", /10%/);
  assert.match(ladderProblem({ ...L, weekdayBasePaise: 250_000 }) ?? "", /floor/);
  assert.equal(peakProblem(PEAK), null);
  assert.match(peakProblem({ ...PEAK, endDate: PEAK.startDate }) ?? "", /last night/);
});
