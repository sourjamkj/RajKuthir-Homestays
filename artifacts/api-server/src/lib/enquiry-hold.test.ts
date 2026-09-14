import assert from "node:assert/strict";
import test from "node:test";

import {
  HOLD_HOURS,
  formatDeadline,
  holdExpiryOf,
  holdStateOf,
} from "./enquiry-hold.ts";

/**
 * The whole point of deriving the hold rather than storing it is that nothing
 * has to run for a hold to expire. These tests are where that claim is kept
 * honest: every case moves the clock, never a flag.
 */

const SENT = new Date("2026-09-12T11:00:00Z"); // 4:30 pm IST
const hoursAfter = (base: Date, hours: number) =>
  new Date(base.getTime() + hours * 3_600_000);

test("hold · nothing is held before a quote is sent", () => {
  const state = holdStateOf({ quoteSentAt: null, advancePaidAt: null }, SENT);
  assert.equal(state.state, "none");
});

test("hold · a fresh quote holds the dates for a full day", () => {
  assert.equal(HOLD_HOURS, 24);

  const state = holdStateOf(
    { quoteSentAt: SENT, advancePaidAt: null },
    hoursAfter(SENT, 1),
  );

  assert.equal(state.state, "held");
  assert.ok(state.state === "held");
  assert.equal(state.hoursLeft, 23);
  assert.equal(state.expiresAt.toISOString(), "2026-09-13T11:00:00.000Z");
});

test("hold · it releases itself when the clock passes, with nothing run", () => {
  // No sweep, no job, no flag cleared. The same row, one second later.
  const justInside = holdStateOf(
    { quoteSentAt: SENT, advancePaidAt: null },
    new Date(holdExpiryOf(SENT).getTime() - 1000),
  );
  const justOutside = holdStateOf(
    { quoteSentAt: SENT, advancePaidAt: null },
    holdExpiryOf(SENT),
  );

  assert.equal(justInside.state, "held");
  assert.equal(justOutside.state, "released");
});

test("hold · a hold left unattended for a month is still simply released", () => {
  // The failure mode of a cron-swept flag: nothing ran, so dates stay blocked.
  const state = holdStateOf(
    { quoteSentAt: SENT, advancePaidAt: null },
    hoursAfter(SENT, 24 * 30),
  );

  assert.equal(state.state, "released");
});

test("hold · once the advance is paid the hold stops expiring", () => {
  const paid = { quoteSentAt: SENT, advancePaidAt: hoursAfter(SENT, 3) };

  for (const hours of [4, 25, 24 * 365]) {
    const state = holdStateOf(paid, hoursAfter(SENT, hours));
    assert.equal(state.state, "paid", `lost a paid booking after ${hours}h`);
  }
});

test("hold · payment counts even if the quote was never recorded as sent", () => {
  // Money in hand is not undone by a missing timestamp.
  const state = holdStateOf(
    { quoteSentAt: null, advancePaidAt: SENT },
    hoursAfter(SENT, 48),
  );

  assert.equal(state.state, "paid");
});

test("hold · hours left rounds up, so a live hold never reads as zero", () => {
  const state = holdStateOf(
    { quoteSentAt: SENT, advancePaidAt: null },
    hoursAfter(SENT, 23.2),
  );

  assert.ok(state.state === "held");
  assert.equal(state.hoursLeft, 1);
});

test("hold · timestamps arriving as strings are handled, not dropped", () => {
  // Postgres hands these back as Dates, but JSON round-trips make them
  // strings, and a hold silently reading as "none" would be invisible.
  const state = holdStateOf(
    { quoteSentAt: SENT.toISOString(), advancePaidAt: null },
    hoursAfter(SENT, 2),
  );

  assert.equal(state.state, "held");
});

test("hold · an unreadable timestamp is treated as absent, not as now", () => {
  const state = holdStateOf(
    { quoteSentAt: "not a date", advancePaidAt: null },
    SENT,
  );

  assert.equal(state.state, "none");
});

test("hold · the deadline is written in India time, for a guest to read", () => {
  // 11:00 UTC on the 13th is 4:30 pm IST the same day. en-IN abbreviates
  // September as "Sept", which is why the month is matched loosely — the
  // existing booking templates render it the same way.
  const text = formatDeadline(new Date("2026-09-13T11:00:00Z"));

  assert.match(text, /13 Sept? 2026/);
  assert.match(text, /4:30/);
  assert.match(text, /pm/i);
});

test("hold · a deadline that crosses midnight IST shows the right date", () => {
  // 20:00 UTC on the 12th is 1:30 am IST on the 13th. A message that says
  // "by 12 Sep" when it means the 13th costs somebody a booking.
  const text = formatDeadline(new Date("2026-09-12T20:00:00Z"));

  assert.match(text, /13 Sept? 2026/);
  assert.match(text, /1:30/);
  assert.match(text, /am/i);
});
