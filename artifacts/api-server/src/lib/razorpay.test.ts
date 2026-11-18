import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { capturedPayment, isRazorpayOrderId, razorpaySignatureValid, readRazorpayConfig } from "./razorpay-rules.ts";

test("signature: HMAC-SHA256 of order|payment must match exactly", () => {
  const secret = "not-a-real-secret";
  const good = createHmac("sha256", secret).update("order_A|pay_B").digest("hex");
  assert.equal(razorpaySignatureValid("order_A", "pay_B", good, secret), true);
  assert.equal(razorpaySignatureValid("order_A", "pay_C", good, secret), false);
  assert.equal(razorpaySignatureValid("order_A", "pay_B", good.slice(1), secret), false);
  assert.equal(razorpaySignatureValid("order_A", "pay_B", "", secret), false);
});

test("config: both keys needed; live keys mean production", () => {
  assert.equal(readRazorpayConfig({ RAZORPAY_KEY_ID: "rzp_test_x" }), null);
  assert.equal(readRazorpayConfig({ RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "s" })?.env, "sandbox");
  assert.equal(readRazorpayConfig({ RAZORPAY_KEY_ID: "rzp_live_x", RAZORPAY_KEY_SECRET: "s" })?.env, "production");
});

test("captured payment maps to the stored shape; uncaptured is ignored", () => {
  assert.equal(capturedPayment([{ id: "pay_1", status: "authorized", amount: 100 }]), null);
  const p = capturedPayment([{ id: "pay_2", status: "captured", amount: 280000, method: "card", card: { type: "credit" }, created_at: 1_700_000_000 }]);
  assert.equal(p?.cfPaymentId, "pay_2");
  assert.equal(p?.paymentGroup, "credit_card");
  assert.equal(p?.amountPaise, 280000);
  assert.equal(isRazorpayOrderId("order_X"), true);
  assert.equal(isRazorpayOrderId("RK-18NOV-1"), false);
});
