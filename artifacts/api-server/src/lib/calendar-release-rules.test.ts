import { test } from "node:test";
import assert from "node:assert/strict";
import { activeReleases, isReleased, newRelease } from "./calendar-release-rules.ts";

const now = new Date("2026-11-11T12:00:00Z");
const r = newRelease("2026-11-22", "2026-11-23", now);

test("a release lasts 48 hours", () => {
  assert.equal(r.until, "2026-11-13T12:00:00.000Z");
  assert.equal(activeReleases([r], new Date("2026-11-13T11:59:00Z")).length, 1);
  assert.equal(activeReleases([r], new Date("2026-11-13T12:01:00Z")).length, 0);
});

test("only OTA copies wholly inside the released nights are dropped", () => {
  assert.equal(isReleased({ startDate: "2026-11-22", endDate: "2026-11-23" }, [r]), true);
  // The neighbouring booking, and a longer event that reaches past the release, stay.
  assert.equal(isReleased({ startDate: "2026-11-21", endDate: "2026-11-22" }, [r]), false);
  assert.equal(isReleased({ startDate: "2026-11-21", endDate: "2026-11-23" }, [r]), false);
  const wide = newRelease("2026-11-22", "2026-11-25", now);
  assert.equal(isReleased({ startDate: "2026-11-23", endDate: "2026-11-24" }, [wide]), true);
  assert.equal(isReleased({ startDate: "2026-11-22", endDate: "2026-11-23" }, []), false);
});
