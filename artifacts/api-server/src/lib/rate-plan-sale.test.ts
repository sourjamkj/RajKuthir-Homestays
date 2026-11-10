import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_LADDER, nightPrice, type PeakPeriod } from "./pricing.ts";
import { salePlan } from "./rate-plan-sale-rules.ts";

const live = { ...DEFAULT_LADDER, weekdayBasePaise: 320_000, weekendBasePaise: 390_000, includedGuests: 2, extraGuestPaise: 35_000, floorPaise: 290_000 };
const oldPeaks: PeakPeriod[] = [
  { id: "poush-mela-new-year-2026", label: "Poush Mela, Christmas & New Year", startDate: "2026-12-22", endDate: "2027-01-02", bookingComPaise: 450_000, discountPercent: 10, minNights: 2 },
  { id: "basanta-utsav-2027", label: "Basanta Utsav", startDate: "2027-03-19", endDate: "2027-03-23", bookingComPaise: 500_000, discountPercent: 10, minNights: 2 },
];

test("sale plan · ₹3,500 for 5 on normal nights, weekday and weekend alike; floor kept", () => {
  const { ladder, peaks } = salePlan(live, oldPeaks);
  for (const night of ["2026-11-14", "2026-11-16", "2027-06-05", "2026-12-29"]) {
    assert.equal(nightPrice(ladder, peaks, night, 5), 350_000, night);
    assert.equal(nightPrice(ladder, peaks, night, 2), 290_000, night);
    assert.equal(nightPrice(ladder, peaks, night, 3), 310_000, night);
  }
});

test("sale plan · a flat ₹4,500 on every peak night, 2026 and 2027, whatever the party", () => {
  const { ladder, peaks } = salePlan(live, oldPeaks);
  for (const night of ["2026-12-23", "2026-12-27", "2026-12-31", "2027-01-01", "2027-03-19", "2027-03-22", "2027-12-25", "2028-01-01"]) {
    assert.equal(nightPrice(ladder, peaks, night, 5), 450_000, night);
    assert.equal(nightPrice(ladder, peaks, night, 2), 450_000, night);
    assert.equal(nightPrice(ladder, peaks, night, 1), 450_000, night);
  }
  for (const night of ["2026-12-22", "2026-12-28", "2026-12-30", "2027-01-02"]) assert.equal(nightPrice(ladder, peaks, night, 5), 350_000, night);
  assert.equal(peaks.length, 5);
  assert.ok(peaks.every((p) => p.minNights === 2));
});
