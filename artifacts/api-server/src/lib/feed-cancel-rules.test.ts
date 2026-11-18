import { test } from "node:test";
import assert from "node:assert/strict";

import { bookingsGoneFromFeed } from "./feed-cancel-rules.ts";

const arkadip = { id: "a", checkIn: "2026-11-21", checkOut: "2026-11-22" };
const today = "2026-11-19";

test("a reservation removed from the feed cancels its booking", () => {
  const gone = bookingsGoneFromFeed({ removed: [{ startDate: "2026-11-21", endDate: "2026-11-22" }], feed: [], bookings: [arkadip], addedCount: 0, today });
  assert.deepEqual(gone.map((b) => b.id), ["a"]);
});

test("nothing removed, still listed, a past stay, or a possible date change: left alone", () => {
  const removed = [{ startDate: "2026-11-21", endDate: "2026-11-22" }];
  assert.equal(bookingsGoneFromFeed({ removed: [], feed: [], bookings: [arkadip], addedCount: 0, today }).length, 0);
  assert.equal(bookingsGoneFromFeed({ removed, feed: [{ startDate: "2026-11-20", endDate: "2026-11-22" }], bookings: [arkadip], addedCount: 0, today }).length, 0);
  assert.equal(bookingsGoneFromFeed({ removed, feed: [], bookings: [arkadip], addedCount: 0, today: "2026-11-22" }).length, 0);
  assert.equal(bookingsGoneFromFeed({ removed, feed: [], bookings: [arkadip], addedCount: 1, today }).length, 0);
});
