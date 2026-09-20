import assert from "node:assert/strict";
import test from "node:test";
import {
  FIRST_VISIT_LOOKBACK_DAYS,
  MAX_ITEMS,
  MAX_LOOKBACK_DAYS,
  activityWindowStart,
  buildActivity,
  seenMarker,
  shortDate,
  type ActivityRows,
} from "./activity-rules.ts";

const NOW = new Date("2026-09-20T10:00:00.000Z");
const DAY = 86_400_000;
const empty = (): ActivityRows => ({ newBookings: [], cancelledBookings: [], otaBlocks: [], enquiries: [], uploads: [] });

test("activity · first ever sign-in looks back one week", () => {
  assert.equal(activityWindowStart(null, NOW).getTime(), NOW.getTime() - FIRST_VISIT_LOOKBACK_DAYS * DAY);
});

test("activity · the window starts at the last-seen marker", () => {
  const seen = new Date("2026-09-19T08:00:00.000Z");
  assert.equal(activityWindowStart(seen, NOW).toISOString(), seen.toISOString());
});

test("activity · a very old marker is capped at the maximum lookback", () => {
  const seen = new Date("2025-01-01T00:00:00.000Z");
  assert.equal(activityWindowStart(seen, NOW).getTime(), NOW.getTime() - MAX_LOOKBACK_DAYS * DAY);
});

test("activity · a marker in the future cannot hide activity", () => {
  const future = new Date(NOW.getTime() + 5 * DAY);
  assert.equal(activityWindowStart(future, NOW).toISOString(), NOW.toISOString());
  assert.equal(activityWindowStart(new Date("nonsense"), NOW).getTime(), NOW.getTime() - FIRST_VISIT_LOOKBACK_DAYS * DAY);
});

test("activity · mark-as-read stores the newest item shown, not now", () => {
  assert.equal(seenMarker("2026-09-20T09:00:00.000Z", NOW).toISOString(), "2026-09-20T09:00:00.000Z");
  assert.equal(seenMarker("2027-01-01T00:00:00.000Z", NOW).toISOString(), NOW.toISOString());
  assert.equal(seenMarker(undefined, NOW).toISOString(), NOW.toISOString());
  assert.equal(seenMarker("junk", NOW).toISOString(), NOW.toISOString());
});

test("activity · items come back newest first, one per event", () => {
  const rows = empty();
  rows.newBookings.push({ id: "b1", source: "makeMyTrip", guestName: "Asha", guestPhone: null, checkIn: "2026-10-03", checkOut: "2026-10-05", createdAt: new Date("2026-09-20T08:00:00Z") });
  rows.enquiries.push({ id: "e1", name: "Rohan", checkIn: null, checkOut: null, createdAt: new Date("2026-09-20T09:00:00Z") });
  rows.uploads.push({ bookingId: "b0", guestName: "Mita", checkIn: "2026-09-25", completedAt: new Date("2026-09-19T09:00:00Z") });

  const items = buildActivity(rows);
  assert.deepEqual(items.map((i) => i.kind), ["enquiry_new", "booking_new", "documents_uploaded"]);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
});

test("activity · an OTA booking with no phone says so", () => {
  const rows = empty();
  rows.newBookings.push({ id: "b1", source: "makeMyTrip", guestName: "Asha", guestPhone: null, checkIn: "2026-10-03", checkOut: "2026-10-05", createdAt: NOW });
  const [item] = buildActivity(rows);
  assert.equal(item.title, "New MakeMyTrip booking");
  assert.match(item.detail, /3 Oct → 5 Oct/);
  assert.match(item.detail, /no phone number yet/);
});

test("activity · the list is capped", () => {
  const rows = empty();
  for (let i = 0; i < MAX_ITEMS + 20; i += 1) {
    rows.enquiries.push({ id: `e${i}`, name: "x", checkIn: null, checkOut: null, createdAt: new Date(NOW.getTime() - i * 1000) });
  }
  assert.equal(buildActivity(rows).length, MAX_ITEMS);
});

test("activity · dates are shown as calendar dates", () => {
  assert.equal(shortDate("2026-12-31"), "31 Dec");
  assert.equal(shortDate(null), "?");
});
