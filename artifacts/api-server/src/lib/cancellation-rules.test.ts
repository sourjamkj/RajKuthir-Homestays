import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cancellationRefund, daysBetween, istDate } from "./cancellation-rules.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
// 10:00 IST on 1 Nov 2026.
const at = (iso: string) => new Date(`${iso}T04:30:00Z`);

test("days are IST calendar days", () => {
  assert.equal(istDate(new Date("2026-11-01T19:00:00Z")), "2026-11-02"); // 00:30 IST next day
  assert.equal(daysBetween("2026-11-01", "2026-11-16"), 15);
  assert.equal(daysBetween("2026-11-20", "2026-11-16"), -4);
});

test("regular dates: 15+ days, 7–14 days, under 7", () => {
  const paid = 195_000; // ₹1,950 advance
  const far = cancellationRefund({ checkIn: "2026-11-16", cancelledAt: at("2026-11-01"), paidPaise: paid, peak: false });
  assert.equal(far.daysBefore, 15);
  assert.equal(far.refundPaise, 175_000);
  assert.equal(far.creditPaise, 0);

  const mid = cancellationRefund({ checkIn: "2026-11-15", cancelledAt: at("2026-11-01"), paidPaise: paid, peak: false });
  assert.equal(mid.daysBefore, 14);
  assert.equal(mid.refundPaise, 97_500);
  assert.equal(mid.creditPaise, 195_000);

  const seven = cancellationRefund({ checkIn: "2026-11-08", cancelledAt: at("2026-11-01"), paidPaise: paid, peak: false });
  assert.equal(seven.refundPaise, 97_500);

  const late = cancellationRefund({ checkIn: "2026-11-07", cancelledAt: at("2026-11-01"), paidPaise: paid, peak: false });
  assert.equal(late.daysBefore, 6);
  assert.equal(late.refundPaise, 0);
  assert.equal(late.creditPaise, 0);

  // Never negative, even on a tiny payment.
  assert.equal(cancellationRefund({ checkIn: "2026-12-30", cancelledAt: at("2026-11-01"), paidPaise: 10_000, peak: false }).refundPaise, 0);
});

test("peak dates: 90% at 30+ days, nothing after", () => {
  const paid = 1_000_000;
  const early = cancellationRefund({ checkIn: "2026-12-24", cancelledAt: at("2026-11-24"), paidPaise: paid, peak: true });
  assert.equal(early.daysBefore, 30);
  assert.equal(early.refundPaise, 900_000);
  const late = cancellationRefund({ checkIn: "2026-12-24", cancelledAt: at("2026-11-25"), paidPaise: paid, peak: true });
  assert.equal(late.refundPaise, 0);
});

test("the policy page states the same numbers", () => {
  const page = readFileSync(path.join(here, "../../../raj-kuthir/src/pages/Policies.tsx"), "utf8");
  for (const phrase of ["15 days or more", "₹200", "7 to 14 days", "Less than 7 days", "paid in full", "30 days or more", "90%"]) {
    assert.ok(page.includes(phrase), `Policies.tsx should say "${phrase}"`);
  }
});
