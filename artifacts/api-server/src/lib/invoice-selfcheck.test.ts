import assert from "node:assert/strict";
import test from "node:test";

import { alertFor, runInvoiceSelfCheck, type SelfCheckResult } from "./invoice-selfcheck-core.ts";

const result = (ok: boolean): SelfCheckResult => ({
  ok,
  checkedAt: "2026-10-29T10:00:00.000Z",
  steps: [{ name: "invoice", ok, ms: 5, ...(ok ? { bytes: 9000 } : { error: "SOI not found in JPEG" }) }],
});

test("self-check · makes both test PDFs from the fictional booking", async () => {
  const run = await runInvoiceSelfCheck(new Date("2026-10-29T10:00:00Z"));
  assert.equal(run.ok, true, JSON.stringify(run.steps));
  assert.deepEqual(run.steps.map((s) => s.name), ["invoice", "confirmation"]);
  for (const step of run.steps) assert.ok((step.bytes ?? 0) > 2000);
});

test("self-check · one email when it starts failing, one when it recovers, none in between", () => {
  const first = alertFor(null, result(false));
  assert.match(first?.subject ?? "", /failing/);
  assert.match(first?.text ?? "", /SOI not found in JPEG/);
  assert.equal(alertFor(result(false), result(false)), null);
  assert.match(alertFor(result(false), result(true))?.subject ?? "", /working again/);
  assert.equal(alertFor(result(true), result(true)), null);
  assert.equal(alertFor(null, result(true)), null, "a healthy first run is not news");
  assert.match(alertFor(result(true), result(false))?.subject ?? "", /failing/);
});
