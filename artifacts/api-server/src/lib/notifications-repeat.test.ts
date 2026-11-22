import assert from "node:assert/strict";
import { test } from "node:test";

import { nextRepeat } from "./notifications-repeat.ts";

const at = (iso: string) => new Date(iso);

test("ID reminder repeats daily, the last on the day before check-in", () => {
  // Booked 20 Dec 1:30 pm IST for a 23 Dec check-in: reminders 21 and 22 Dec, then stop.
  assert.equal(nextRepeat("verification_reminder", "2026-12-23", "2026-12-25", at("2026-12-20T08:00:00Z"))?.toISOString(), "2026-12-21T08:00:00.000Z");
  assert.equal(nextRepeat("verification_reminder", "2026-12-23", "2026-12-25", at("2026-12-21T08:00:00Z"))?.toISOString(), "2026-12-22T08:00:00.000Z");
  assert.equal(nextRepeat("verification_reminder", "2026-12-23", "2026-12-25", at("2026-12-22T08:00:00Z")), null);
});

test("review: one reminder at 6 pm the next day, only after the check-out-day ask", () => {
  assert.equal(nextRepeat("review_request", "2026-12-23", "2026-12-25", at("2026-12-25T08:30:00Z"))?.toISOString(), "2026-12-26T12:30:00.000Z");
  assert.equal(nextRepeat("review_request", "2026-12-23", "2026-12-25", at("2026-12-26T12:30:00Z")), null, "the reminder itself does not repeat");
  assert.equal(nextRepeat("review_request", "2026-12-23", "2026-12-25", at("2026-12-26T05:30:00Z")), null, "a late first ask (next day 11 am) gets no reminder");
});
