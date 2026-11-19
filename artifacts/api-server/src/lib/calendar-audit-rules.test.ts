import { test } from "node:test";
import assert from "node:assert/strict";

import { auditCalendarRows, hasReason } from "./calendar-audit-rules.ts";

const today = "2026-11-19";
const row = (id: string, source: string, startDate: string, endDate: string, title: string | null = null) =>
  ({ id, source, origin: "event" as const, startDate, endDate, title });

test("owner blocks need a real reason", () => {
  assert.equal(hasReason("Blocked by host"), false);
  assert.equal(hasReason("  "), false);
  assert.equal(hasReason("Family visit"), true);
  const issues = auditCalendarRows([row("a", "manual", "2026-11-28", "2026-11-29", "Blocked by host"), row("b", "manual", "2026-12-05", "2026-12-06", "Repairs")], [], today);
  assert.deepEqual([...issues], [["a", "no_reason"]]);
});

test("OTA closures need a booking or an owner block behind them", () => {
  const rows = [
    row("booked", "bookingCom", "2026-12-01", "2026-12-03"),
    row("echo", "airbnb", "2026-12-05", "2026-12-06"),
    row("owner", "manual", "2026-12-05", "2026-12-06", "Repairs"),
    row("orphan", "makeMyTrip", "2026-11-28", "2026-11-29"),
    row("past", "airbnb", "2026-11-10", "2026-11-12"),
  ];
  const issues = auditCalendarRows(rows, [{ checkIn: "2026-12-01", checkOut: "2026-12-03" }], today);
  assert.deepEqual([...issues], [["orphan", "no_booking"]]);
});
