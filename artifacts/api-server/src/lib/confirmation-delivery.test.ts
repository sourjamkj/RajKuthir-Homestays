import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  advanceReceiptLine,
  delivered,
  deliverOnChannels,
  deliverySummary,
  dueForRetry,
  type DeliveryDeps,
} from "./confirmation-delivery.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIN = 60_000;
const NOW = new Date("2026-11-02T10:00:00Z");

function deps(over: { email?: boolean | "throw"; whatsapp?: "ok" | "fail" | "throw" | "off" | "nonumber" }) {
  const calls: string[] = [];
  const d: DeliveryDeps = {
    sendEmail: async (to) => {
      calls.push(`email:${to}`);
      if (over.email === "throw") throw new Error("smtp down");
      return over.email ?? true;
    },
    whatsapp:
      over.whatsapp === "off"
        ? null
        : {
            to: over.whatsapp === "nonumber" ? null : "919876543210",
            send: async (to) => {
              calls.push(`whatsapp:${to}`);
              if (over.whatsapp === "throw") throw new Error("graph timeout");
              return over.whatsapp === "fail" ? { ok: false, error: "template not approved" } : { ok: true };
            },
          },
  };
  return { d, calls };
}

test("both channels are used, not the first that works", async () => {
  const { d, calls } = deps({ email: true, whatsapp: "ok" });
  const result = await deliverOnChannels("guest@example.com", d);
  assert.deepEqual(calls, ["email:guest@example.com", "whatsapp:919876543210"]);
  assert.equal(result.email, "sent");
  assert.equal(result.whatsapp, "sent");
  assert.equal(delivered(result), true);
  assert.equal(deliverySummary(result), "email sent to guest@example.com, whatsapp sent to 919876543210");
});

test("one channel failing never stops the other", async () => {
  const emailDown = await deliverOnChannels("guest@example.com", deps({ email: "throw", whatsapp: "ok" }).d);
  assert.equal(emailDown.email, "failed");
  assert.equal(emailDown.whatsapp, "sent");
  assert.equal(delivered(emailDown), true);

  const whatsappDown = await deliverOnChannels("guest@example.com", deps({ email: true, whatsapp: "throw" }).d);
  assert.equal(whatsappDown.email, "sent");
  assert.equal(whatsappDown.whatsapp, "failed");
  assert.match(deliverySummary(whatsappDown), /email sent.*whatsapp failed \(graph timeout\)/);

  const rejected = await deliverOnChannels(null, deps({ whatsapp: "fail" }).d);
  assert.equal(rejected.whatsapp, "failed");
  assert.match(rejected.notes.join(" "), /template not approved/);
});

test("nothing configured: both skipped, and the summary says it was not delivered", async () => {
  const { d, calls } = deps({ whatsapp: "off" });
  const result = await deliverOnChannels(null, d);
  assert.deepEqual(calls, []);
  assert.equal(result.email, "skipped");
  assert.equal(result.whatsapp, "skipped");
  assert.equal(delivered(result), false);
  assert.match(deliverySummary(result), /^not delivered; email skipped \(no address\); whatsapp skipped/);

  const noNumber = await deliverOnChannels("not-an-email", deps({ whatsapp: "nonumber" }).d);
  assert.equal(noNumber.email, "skipped");
  assert.equal(noNumber.whatsapp, "skipped");
  assert.match(noNumber.notes.join(" "), /no valid number/);
});

test("retries only failed sends, a few minutes apart, for half an hour", () => {
  const base = { emailStatus: "failed", whatsappStatus: "skipped", attempts: 1, createdAt: new Date(NOW.getTime() - 10 * MIN), updatedAt: new Date(NOW.getTime() - 6 * MIN) };
  assert.equal(dueForRetry(base, NOW), true);
  assert.equal(dueForRetry({ ...base, emailStatus: "sent" }, NOW), false);
  assert.equal(dueForRetry({ ...base, whatsappStatus: "sent" }, NOW), false);
  assert.equal(dueForRetry({ ...base, emailStatus: "skipped" }, NOW), false, "all skipped: retrying cannot help");
  assert.equal(dueForRetry({ ...base, attempts: 3 }, NOW), false);
  assert.equal(dueForRetry({ ...base, createdAt: new Date(NOW.getTime() - 31 * MIN) }, NOW), false);
  assert.equal(dueForRetry({ ...base, updatedAt: new Date(NOW.getTime() - 2 * MIN) }, NOW), false);
});

test("the PDF says how the advance was paid", () => {
  assert.equal(
    advanceReceiptLine({ online: { method: "UPI", paidAt: new Date("2026-10-30T20:12:00Z"), cfPaymentId: "5114917039" }, utr: null }),
    "Paid online 31 Oct 2026, 1:42 am · UPI · Cashfree payment ID 5114917039",
  );
  assert.equal(advanceReceiptLine({ online: { method: "Credit card", paidAt: null, cfPaymentId: null }, utr: null }), "Paid online · Credit card");
  assert.equal(advanceReceiptLine({ online: null, utr: "412345678901" }), "Paid by UPI · UTR 412345678901");
  assert.equal(advanceReceiptLine({ online: null, utr: null }), null);
});

test("confirmation_deliveries is in the boot migration and the schema", () => {
  const sql = readFileSync(path.join(here, "../db/cashfree.sql"), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS confirmation_deliveries/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS confirmation_delivery_booking_uniq ON confirmation_deliveries \(booking_id\)/);
  const schema = readFileSync(path.join(here, "../../../../lib/db/src/schema/gateway.ts"), "utf8");
  assert.match(schema, /pgTable\(\s*"confirmation_deliveries"/);
  const confirm = readFileSync(path.join(here, "book-pay-confirm.ts"), "utf8");
  assert.match(confirm, /logPaymentEvent\(request\.id, "confirmation_sent"/);
});
