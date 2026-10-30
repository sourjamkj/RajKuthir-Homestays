import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkoutWindow,
  istIso,
  methodLabel,
  orderIdFor,
  orderIdFromWebhook,
  paiseFromRupees,
  readCashfreeConfig,
  refundIdFor,
  refundProblem,
  refundablePaise,
  rupeesFromPaise,
  settlementFor,
  successfulPayment,
  verifyWebhook,
  webhookSignature,
} from "./cashfree-rules.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIN = 60_000;
const NOW = new Date("2026-11-02T10:00:00Z");

test("config: off without both keys, sandbox unless production is spelled out", () => {
  assert.equal(readCashfreeConfig({}), null);
  assert.equal(readCashfreeConfig({ CASHFREE_APP_ID: "a" }), null);
  const sandbox = readCashfreeConfig({ CASHFREE_APP_ID: "a", CASHFREE_SECRET_KEY: "s" })!;
  assert.equal(sandbox.env, "sandbox");
  assert.equal(sandbox.baseUrl, "https://sandbox.cashfree.com/pg");
  assert.equal(sandbox.webhookKey, "s");
  const typo = readCashfreeConfig({ CASHFREE_APP_ID: "a", CASHFREE_SECRET_KEY: "s", CASHFREE_ENV: "prod" })!;
  assert.equal(typo.env, "sandbox");
  const live = readCashfreeConfig({ CASHFREE_APP_ID: "a", CASHFREE_SECRET_KEY: "s", CASHFREE_ENV: " Production ", CASHFREE_WEBHOOK_SECRET: "w" })!;
  assert.equal(live.env, "production");
  assert.equal(live.baseUrl, "https://api.cashfree.com/pg");
  assert.equal(live.webhookKey, "w");
});

test("amounts round-trip between paise and rupees without float drift", () => {
  assert.equal(rupeesFromPaise(160_000), 1600);
  assert.equal(rupeesFromPaise(160_050), 1600.5);
  assert.equal(paiseFromRupees(1600.5), 160_050);
  assert.equal(paiseFromRupees("2899.99"), 289_999);
  assert.equal(paiseFromRupees(0.1 + 0.2), 30);
  assert.equal(paiseFromRupees(-1), null);
  assert.equal(paiseFromRupees("abc"), null);
});

test("order and refund ids use only characters Cashfree accepts", () => {
  assert.equal(orderIdFor("RK-2026-0042", 1), "RK-2026-0042-1");
  assert.match(orderIdFor("RK 2026/0042", 3), /^[A-Za-z0-9_-]+$/);
  assert.match(refundIdFor("RK-2026-0042", 2), /^RF-RK-2026-0042-2$/);
});

test("IST timestamps carry the +05:30 offset", () => {
  assert.equal(istIso(NOW), "2026-11-02T15:30:00+05:30");
});

test("checkout never outlives the hold: a short hold is stretched to cover it", () => {
  const plenty = new Date(NOW.getTime() + 25 * MIN);
  assert.deepEqual(checkoutWindow(plenty, NOW), { orderExpiresAt: plenty, holdExpiresAt: plenty });

  const short = new Date(NOW.getTime() + 5 * MIN);
  const window = checkoutWindow(short, NOW);
  assert.equal(window.orderExpiresAt.getTime(), NOW.getTime() + 20 * MIN);
  assert.equal(window.holdExpiresAt.getTime(), window.orderExpiresAt.getTime());
});

function signed(body: string, at: Date, key = "secret") {
  const timestamp = String(at.getTime());
  return { timestamp, signature: webhookSignature(timestamp, Buffer.from(body), key), rawBody: Buffer.from(body) };
}

test("webhook signature: base64 HMAC-SHA256 of timestamp + raw body", () => {
  const body = '{"data":{"order":{"order_id":"RK-1-1"}},"type":"PAYMENT_SUCCESS_WEBHOOK"}';
  const timestamp = "1762077600000";
  const expected = createHmac("sha256", "secret").update(timestamp + body).digest("base64");
  assert.equal(webhookSignature(timestamp, body, "secret"), expected);
});

test("webhook verification accepts the real thing and nothing else", () => {
  const body = '{"data":{"order":{"order_id":"RK-1-1"}}}';
  const good = signed(body, NOW);
  assert.deepEqual(verifyWebhook({ ...good, key: "secret", now: NOW }), { ok: true });

  // Tampered body, wrong key, missing headers.
  assert.deepEqual(
    verifyWebhook({ ...good, rawBody: Buffer.from(body.replace("RK-1-1", "RK-9-9")), key: "secret", now: NOW }),
    { ok: false, reason: "mismatch" },
  );
  assert.deepEqual(verifyWebhook({ ...good, key: "other", now: NOW }), { ok: false, reason: "mismatch" });
  assert.deepEqual(verifyWebhook({ ...good, signature: undefined, key: "secret", now: NOW }), { ok: false, reason: "missing" });
  assert.deepEqual(verifyWebhook({ ...good, rawBody: undefined, key: "secret", now: NOW }), { ok: false, reason: "missing" });

  // Replays: older than five minutes is refused.
  const old = signed(body, new Date(NOW.getTime() - 6 * MIN));
  assert.deepEqual(verifyWebhook({ ...old, key: "secret", now: NOW }), { ok: false, reason: "stale" });

  // A timestamp in seconds is read as seconds.
  const seconds = String(Math.floor(NOW.getTime() / 1000));
  const inSeconds = { timestamp: seconds, signature: webhookSignature(seconds, body, "secret"), rawBody: Buffer.from(body) };
  assert.deepEqual(verifyWebhook({ ...inSeconds, key: "secret", now: NOW }), { ok: true });
});

test("webhook order id is read defensively", () => {
  assert.equal(orderIdFromWebhook({ data: { order: { order_id: "RK-2026-0042-1" } } }), "RK-2026-0042-1");
  assert.equal(orderIdFromWebhook({ data: { order: { order_id: "../../etc" } } }), null);
  assert.equal(orderIdFromWebhook({}), null);
  assert.equal(orderIdFromWebhook(null), null);
});

test("only PAID for exactly the advance counts as paid", () => {
  assert.deepEqual(settlementFor({ order_status: "PAID", order_amount: 1600 }, 160_000), { kind: "paid" });
  assert.deepEqual(settlementFor({ order_status: "PAID", order_amount: 16 }, 160_000), {
    kind: "amount_mismatch",
    expectedPaise: 160_000,
    gotPaise: 1_600,
  });
  assert.deepEqual(settlementFor({ order_status: "ACTIVE", order_amount: 1600 }, 160_000), { kind: "pending" });
  assert.deepEqual(settlementFor({}, 160_000), { kind: "pending" });
  assert.deepEqual(settlementFor({ order_status: "EXPIRED" }, 160_000), { kind: "closed", status: "EXPIRED" });
  assert.deepEqual(settlementFor({ order_status: "TERMINATED" }, 160_000), { kind: "closed", status: "TERMINATED" });
});

test("the successful payment is picked out of Cashfree's attempts", () => {
  const attempts = [
    { cf_payment_id: 1, payment_status: "FAILED", payment_group: "credit_card", payment_amount: 1600 },
    { cf_payment_id: 2, payment_status: "SUCCESS", payment_group: "upi", payment_amount: 1600, bank_reference: "412345678901", payment_completion_time: "2026-11-02T15:31:00+05:30" },
  ];
  const paid = successfulPayment(attempts)!;
  assert.equal(paid.cfPaymentId, "2");
  assert.equal(paid.paymentGroup, "upi");
  assert.equal(paid.bankReference, "412345678901");
  assert.equal(paid.amountPaise, 160_000);
  assert.equal(paid.paidAt?.toISOString(), "2026-11-02T10:01:00.000Z");
  assert.equal(successfulPayment([attempts[0]]), null);
  assert.equal(successfulPayment("nope"), null);
});

test("method labels read naturally", () => {
  assert.equal(methodLabel("upi"), "UPI");
  assert.equal(methodLabel("net_banking"), "Net banking");
  assert.equal(methodLabel(null), "Online");
  assert.equal(methodLabel("pay_later"), "pay later");
});

test("refunds can never exceed what was paid", () => {
  const paid = 160_000;
  assert.equal(refundablePaise(paid, []), 160_000);
  assert.equal(
    refundablePaise(paid, [
      { amountPaise: 50_000, status: "SUCCESS" },
      { amountPaise: 20_000, status: "PENDING" },
      { amountPaise: 90_000, status: "CANCELLED" },
    ]),
    90_000,
  );
  assert.equal(refundProblem(90_000, 90_000), null);
  assert.match(refundProblem(90_001, 90_000)!, /At most ₹900\.00/);
  assert.match(refundProblem(50, 90_000)!, /at least ₹1/);
  assert.match(refundProblem(1.5, 90_000)!, /at least ₹1/);
  assert.match(refundProblem("100", 90_000)!, /at least ₹1/);
  assert.match(refundProblem(10_000, 0)!, /already been refunded/);
});

test("the boot-time migration is exactly src/db/cashfree.sql, and matches the schema", () => {
  const sql = readFileSync(path.join(here, "../db/cashfree.sql"), "utf8");
  const ts = readFileSync(path.join(here, "cashfree-migrate.ts"), "utf8");
  const start = ts.indexOf("CASHFREE_MIGRATION_SQL = `") + "CASHFREE_MIGRATION_SQL = `".length;
  assert.equal(ts.slice(start, ts.indexOf("`;", start)), sql);

  // Additive only: nothing existing is altered or dropped.
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /^\s*(ALTER|DROP|TRUNCATE|DELETE)\b/im);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS gateway_order_order_id_uniq ON gateway_orders \(order_id\)/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS gateway_refund_refund_id_uniq ON gateway_refunds \(refund_id\)/);

  const schema = readFileSync(path.join(here, "../../../../lib/db/src/schema/gateway.ts"), "utf8");
  for (const column of [...sql.matchAll(/^\s{2}([a-z_]+)\s+(?:uuid|text|integer|timestamptz|jsonb)/gm)].map((m) => m[1])) {
    assert.match(schema, new RegExp(`"${column}"`), `schema is missing ${column}`);
  }
});
