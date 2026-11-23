import { test } from "node:test";
import assert from "node:assert/strict";

import { assertIcsBody, parseIcs } from "./ics-utils.ts";

test("an HTML error page served with 200 is rejected", () => {
  assert.throws(() => assertIcsBody("<html><body>Service unavailable</body></html>"), /not an iCalendar/);
  assert.throws(() => assertIcsBody(""), /not an iCalendar/);
});

test("a valid empty calendar is accepted and parses to no events", () => {
  const empty = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
  assert.doesNotThrow(() => assertIcsBody(empty));
  assert.equal(parseIcs(empty, "airbnb").length, 0);
});
