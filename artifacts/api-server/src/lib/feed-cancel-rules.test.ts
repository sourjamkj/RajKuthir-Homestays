import { test } from "node:test";
import assert from "node:assert/strict";

import { bookingsGoneFromFeed, feedEmptiedSuddenly } from "./feed-cancel-rules.ts";

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

test("an emptied feed with future confirmed bookings is kept, not cancelled", () => {
  assert.equal(feedEmptiedSuddenly({ storedEventCount: 3, feedEventCount: 0, bookings: [arkadip], today }), true);
});

test("an empty feed is fine when nothing is at stake, and a non-empty feed is never 'emptied'", () => {
  assert.equal(feedEmptiedSuddenly({ storedEventCount: 3, feedEventCount: 0, bookings: [], today }), false);
  assert.equal(feedEmptiedSuddenly({ storedEventCount: 3, feedEventCount: 0, bookings: [arkadip], today: "2026-11-22" }), false);
  assert.equal(feedEmptiedSuddenly({ storedEventCount: 0, feedEventCount: 0, bookings: [arkadip], today }), false);
  assert.equal(feedEmptiedSuddenly({ storedEventCount: 3, feedEventCount: 2, bookings: [arkadip], today }), false);
});

test("one of two events removed still cancels that booking", () => {
  const removed = [{ startDate: "2026-11-21", endDate: "2026-11-22" }];
  const feed = [{ startDate: "2026-12-01", endDate: "2026-12-03" }];
  assert.equal(feedEmptiedSuddenly({ storedEventCount: 2, feedEventCount: 1, bookings: [arkadip], today }), false);
  assert.deepEqual(bookingsGoneFromFeed({ removed, feed, bookings: [arkadip], addedCount: 0, today }).map((b) => b.id), ["a"]);
});
