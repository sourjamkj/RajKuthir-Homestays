import { test } from "node:test";
import assert from "node:assert/strict";

import { alertFor, blockWithoutBookingCheck, databaseCheck, doubleBookingCheck, paidNotBookedCheck, jobCheck, logEntryFrom, outboxCheck, publicStatus, sanitize, step, withMissingAsOk, type CheckState } from "./ops-rules.ts";

const MIN = 60_000;
const at = (iso: string) => new Date(iso);

test("sanitize strips secrets, contacts and connection strings but keeps dates", () => {
  const raw =
    "postgres://app:hunter2@db.internal:5432/rk failed; Authorization: Bearer abc.def.ghi token=sk_live_12345678abcd " +
    "guest asha@example.com +91 98300 12345 at 2026-11-23 13:24 key=\"s3cr3t\" eyJhbGciOiJIUzI1.eyJzdWIiOiIx.c2ln";
  const out = sanitize(raw);
  for (const leak of ["hunter2", "abc.def.ghi", "sk_live", "asha@", "98300", "s3cr3t", "eyJhbGci"]) {
    assert.ok(!out.includes(leak), `${leak} leaked: ${out}`);
  }
  assert.ok(out.includes("2026-11-23 13:24"));
  const snake = sanitize("api_key=abcd1234 client_secret=Sh0rt access_token=EAAGshort123 /x?apikey=zz9 paid to rk@okaxis");
  for (const leak of ["abcd1234", "Sh0rt", "EAAGshort123", "zz9", "rk@okaxis"]) assert.ok(!snake.includes(leak), `${leak} leaked: ${snake}`);
});

test("an open incident whose check stops reporting closes after two runs", () => {
  const t = at("2026-11-23T05:00:00Z");
  let r = step({}, [outboxCheck(2)], t);
  r = step(r.states, [outboxCheck(2)], t);
  assert.equal(r.states.outbox!.failing, true);
  // WhatsApp switched to manual: the outbox check no longer runs.
  r = step(r.states, withMissingAsOk(r.states, [], { outbox: "WhatsApp messages waiting to send" }), t);
  r = step(r.states, withMissingAsOk(r.states, [], { outbox: "WhatsApp messages waiting to send" }), t);
  assert.deepEqual(r.events.map((e) => e.kind), ["recovered"]);
  assert.equal(r.events[0]!.check.label, "WhatsApp messages waiting to send");
  assert.equal(r.states.outbox!.failing, false);
});

test("a job is broken only after three silent intervals or three failures", () => {
  const start = 0;
  const beat = { startedAt: start, lastOk: start, lastError: null, failsInRow: 0 };
  assert.equal(jobCheck("calendar", beat, start + 40 * MIN).ok, true);
  assert.equal(jobCheck("calendar", beat, start + 48 * MIN).ok, false);
  const failing = jobCheck("calendar", { ...beat, failsInRow: 3, lastError: "fetch failed for https://x/?token=abc123" }, start + MIN);
  assert.equal(failing.ok, false);
  assert.equal(failing.severity, "P1");
  assert.ok(!failing.summary.includes("abc123"));
});

test("two agreeing runs open an incident; one blip opens nothing", () => {
  const t = at("2026-11-23T05:00:00Z");
  let r = step({}, [databaseCheck(false)], t);
  assert.equal(r.events.length, 0);
  r = step(r.states, [databaseCheck(true)], t);
  assert.equal(r.events.length, 0, "a single failed run is noise");
  r = step(r.states, [databaseCheck(false)], t);
  r = step(r.states, [databaseCheck(false)], t);
  assert.deepEqual(r.events.map((e) => e.kind), ["opened"]);
  // Steady failure stays silent the same day.
  r = step(r.states, [databaseCheck(false)], t);
  assert.equal(r.events.length, 0);
});

test("recovery needs two good runs, and a return is a new incident", () => {
  const t1 = at("2026-11-23T05:00:00Z");
  const t2 = at("2026-11-23T06:00:00Z");
  let r = step({}, [outboxCheck(3)], t1);
  r = step(r.states, [outboxCheck(3)], t1);
  const first = r.events[0]!.incident;
  r = step(r.states, [outboxCheck(0)], t2);
  assert.equal(r.events.length, 0);
  r = step(r.states, [outboxCheck(0)], t2);
  assert.deepEqual(r.events.map((e) => e.kind), ["recovered"]);
  assert.equal(r.events[0]!.incident, first);
  r = step(r.states, [outboxCheck(1)], t2);
  r = step(r.states, [outboxCheck(1)], t2);
  assert.notEqual(r.events[0]!.incident, first);
});

test("open P0/P1 reminds once per IST day; worse severity escalates", () => {
  const states: Record<string, CheckState> = {
    outbox: { failing: true, streak: 0, severity: "P1", openedAt: "2026-11-22T05:00:00.000Z", remindedDay: "2026-11-22" },
  };
  let r = step(states, [outboxCheck(2)], at("2026-11-23T03:00:00Z"));
  assert.deepEqual(r.events.map((e) => e.kind), ["reminder"]);
  r = step(r.states, [outboxCheck(2)], at("2026-11-23T09:00:00Z"));
  assert.equal(r.events.length, 0);
  r = step(r.states, [{ ...outboxCheck(9), severity: "P0" }], at("2026-11-23T09:05:00Z"));
  assert.deepEqual(r.events.map((e) => e.kind), ["escalated"]);
});

test("alert keys are stable per incident, reminders per day", () => {
  const event = { kind: "reminder" as const, check: outboxCheck(1), incident: "outbox@x" };
  assert.equal(alertFor(event, "2026-11-23").dedupeKey, alertFor(event, "2026-11-23").dedupeKey);
  assert.notEqual(alertFor(event, "2026-11-23").dedupeKey, alertFor(event, "2026-11-24").dedupeKey);
});

test("public status is 503 only for an open P0 and never carries error text", () => {
  const p2: CheckState = { failing: true, streak: 0, severity: "P2", openedAt: "t", remindedDay: null };
  assert.equal(publicStatus({ "job:mail": p2 }, {}).httpStatus, 200);
  assert.equal(publicStatus({ "job:mail": p2 }, {}).body.status, "degraded");
  // A P1 reaches the owner through app alerts; the outside monitor stays green.
  assert.equal(publicStatus({ "job:calendar": { ...p2, severity: "P1" } }, {}).httpStatus, 200);
  const down = publicStatus({ database: { ...p2, severity: "P0" } }, { database: "Database" });
  assert.equal(down.httpStatus, 503);
  assert.deepEqual(Object.keys(down.body.open[0]!), ["check", "severity", "since"]);
});

test("log entries keep message, error and stack top, sanitised; info is dropped", () => {
  const now = at("2026-11-23T05:00:00Z");
  assert.equal(logEntryFrom([{ a: 1 }, "hello"], 30, now), null);
  const err = new Error("connect failed postgres://u:pw@host/db token=abc12345");
  const e = logEntryFrom([{ err, source: "airbnb", guest: { phone: "919830012345" } }, "Calendar feed failed"], 50, now)!;
  assert.equal(e.level, "error");
  assert.equal(e.msg, "Calendar feed failed");
  assert.equal(e.where, "airbnb");
  assert.ok(e.error && !e.error.includes("pw@") && !e.error.includes("abc12345"));
  assert.ok(e.stack && e.stack.length > 0 && e.stack.length <= 6);
  assert.ok(!JSON.stringify(e).includes("919830012345"), "unlisted fields are not copied");
  assert.equal(logEntryFrom(["plain warning"], 40, now)!.msg, "plain warning");
});

test("database errors keep the real cause and never the query params", () => {
  const err = new Error('Failed query: select * from "bookings" where "guest_name" = $1\nparams: Asha Roy', {
    cause: new Error('relation "bookings" does not exist'),
  });
  const e = logEntryFrom([{ err }, "Unhandled error"], 50, at("2026-11-23T05:00:00Z"))!;
  assert.ok(e.error!.includes('relation "bookings" does not exist'), e.error);
  assert.ok(!e.error!.includes("Asha"), e.error);
});

test("integrity checks are P0, ok when no rows, and name dates but never people", () => {
  for (const c of [doubleBookingCheck([]), paidNotBookedCheck([]), blockWithoutBookingCheck([])]) {
    assert.equal(c.ok, true);
    assert.equal(c.severity, "P0");
  }
  const d = doubleBookingCheck([{ aIn: "2026-12-01", aOut: "2026-12-03", bIn: "2026-12-02", bOut: "2026-12-04" }]);
  assert.equal(d.ok, false);
  assert.equal(d.id, "integrity:double_booking");
  assert.match(d.summary, /1 pair of confirmed bookings overlap: 2026-12-01 to 2026-12-03 with 2026-12-02 to 2026-12-04\./);
  const p = paidNotBookedCheck([{ checkIn: "2026-12-01", checkOut: "2026-12-03", bookingStatus: null }, { checkIn: null, checkOut: null, bookingStatus: "pending" }]);
  assert.match(p.summary, /2 paid online orders have no confirmed booking: 2026-12-01 to 2026-12-03 \(no booking\); dates unknown \(pending\)\./);
  const b = blockWithoutBookingCheck([{ startDate: "2026-12-05", endDate: "2026-12-06", issue: "no_reason" }, { startDate: "2026-12-07", endDate: "2026-12-08", issue: "no_booking" }]);
  assert.match(b.summary, /owner block without a reason/);
  assert.match(b.summary, /no booking behind it/);
});

test("a long integrity list is capped and the three checks have distinct ids", () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ startDate: `2026-12-0${i + 1}`, endDate: `2026-12-0${i + 2}`, issue: "no_booking" as const }));
  assert.match(blockWithoutBookingCheck(many).summary, /; and 3 more\.$/);
  assert.equal(new Set([doubleBookingCheck([]).id, paidNotBookedCheck([]).id, blockWithoutBookingCheck([]).id]).size, 3);
});

test("an open integrity incident opens after two runs, then recovers after two clean ones", () => {
  const bad = doubleBookingCheck([{ aIn: "2026-12-01", aOut: "2026-12-03", bIn: "2026-12-02", bOut: "2026-12-04" }]);
  const t = new Date("2026-12-01T06:00:00Z");
  let r = step({}, [bad], t);
  assert.equal(r.events.length, 0);
  r = step(r.states, [bad], t);
  assert.deepEqual(r.events.map((e) => e.kind), ["opened"]);
  r = step(r.states, [doubleBookingCheck([])], t);
  r = step(r.states, [doubleBookingCheck([])], t);
  assert.deepEqual(r.events.map((e) => e.kind), ["recovered"]);
});

test("an open integrity incident never makes the public health 503 or appears in it", () => {
  const open: CheckState = { failing: true, streak: 0, severity: "P0", openedAt: "2026-12-01T06:00:00.000Z", remindedDay: null };
  const hidden = publicStatus({ "integrity:double_booking": open }, { "integrity:double_booking": "Double bookings" });
  assert.equal(hidden.httpStatus, 200);
  assert.deepEqual(hidden.body, { status: "ok", open: [] });
  assert.equal(publicStatus({ database: open }, { database: "Database" }).httpStatus, 503);
});
