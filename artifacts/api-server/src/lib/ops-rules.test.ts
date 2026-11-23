import { test } from "node:test";
import assert from "node:assert/strict";

import { alertFor, databaseCheck, jobCheck, outboxCheck, publicStatus, sanitize, step, withMissingAsOk, type CheckState } from "./ops-rules.ts";

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
