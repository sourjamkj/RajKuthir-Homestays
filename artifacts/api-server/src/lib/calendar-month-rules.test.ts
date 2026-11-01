import assert from "node:assert/strict";
import test from "node:test";

import { buildMonth, daysOfMonth, parseMonth, shiftMonth } from "./calendar-month-rules.ts";

test("months: length, neighbours, and a bad query falls back to this month", () => {
  assert.equal(daysOfMonth("2027-02").length, 28);
  assert.equal(daysOfMonth("2028-02").length, 29);
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(parseMonth("2026-13", "2026-11-01"), "2026-11");
  assert.equal(parseMonth("2027-01", "2026-11-01"), "2027-01");
});

test("each day says who is in, what is closed, what is held, and what a free night costs", () => {
  const month = buildMonth({
    month: "2026-11",
    today: "2026-11-05",
    events: [
      { id: "a", source: "direct", startDate: "2026-11-06", endDate: "2026-11-08", title: "Booked — Ananya Sen", origin: "booking" },
      { id: "b", source: "airbnb", startDate: "2026-11-10", endDate: "2026-11-12", title: "Airbnb (Not available)", origin: "event" },
      { id: "c", source: "manual", startDate: "2026-11-02", endDate: "2026-11-03", title: "Painting", origin: "event" },
    ],
    holds: [{ id: "h", startDate: "2026-11-20", endDate: "2026-11-22" }],
    peaks: [{ label: "Poush Mela", startDate: "2026-11-25", endDate: "2026-11-27", minNights: 2 }],
    priceFor: (date) => (new Date(`${date}T00:00:00Z`).getUTCDay() >= 5 ? 390_000 : 320_000),
  });
  const day = (d: number) => month.days[d - 1]!;
  assert.equal(month.days.length, 30);
  assert.deepEqual([day(1).status, day(2).status], ["past", "blocked"], "past free nights are 'past'; a past block stays a block");
  assert.deepEqual([day(6).status, day(6).label, day(6).checkIn, day(6).source], ["booked", "Ananya Sen", true, "direct"]);
  assert.deepEqual([day(7).status, day(7).checkIn], ["booked", false]);
  assert.deepEqual([day(8).status, day(8).checkOut, day(8).pricePaise], ["free", true, 320_000], "checkout morning is free to sell");
  assert.deepEqual([day(10).status, day(10).label], ["blocked", "Airbnb (Not available)"]);
  assert.equal(day(12).checkOut, false, "a block ending is not a guest leaving");
  assert.deepEqual([day(20).status, day(20).label, day(20).pricePaise], ["held", "Payment pending", null]);
  assert.deepEqual([day(25).peak, day(25).minNights], ["Poush Mela", 2]);
  assert.equal(day(6).pricePaise, null, "no price on a booked night");
  assert.equal(month.summary.bookedNights, 2);
  assert.equal(month.summary.heldNights, 2);
  assert.equal(month.summary.blockedNights, 3);
  assert.equal(month.previous, "2026-10");
  assert.equal(month.next, "2026-12");
  // 26 nights from the 5th; 2 blocked (10th, 11th) leave 24 sellable; 4 taken.
  assert.equal(month.summary.occupancyAheadPercent, Math.round((4 / 24) * 100));
});
