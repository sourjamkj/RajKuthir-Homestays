import { createHmac, timingSafeEqual } from "node:crypto";
import type { CashfreeEnv, PaymentSummary } from "./cashfree-rules";

/** Razorpay decisions with no I/O, so they can be tested. Calls live in razorpay.ts. */

export type RazorpayConfig = { keyId: string; keySecret: string; env: CashfreeEnv };

export function readRazorpayConfig(env: Record<string, string | undefined>): RazorpayConfig | null {
  const keyId = env["RAZORPAY_KEY_ID"]?.trim();
  const keySecret = env["RAZORPAY_KEY_SECRET"]?.trim();
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret, env: keyId.startsWith("rzp_live_") ? "production" : "sandbox" };
}

/** Razorpay's own ids: order_…, pay_…, rfnd_…. Tells a Razorpay row from a Cashfree one. */
export function isRazorpayOrderId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("order_");
}

/** Razorpay refund status in the words the refunds table already uses (Cashfree's). */
export function refundStatusFrom(status: string): string {
  return status === "processed" ? "SUCCESS" : status === "failed" ? "CANCELLED" : "PENDING";
}

/** HMAC-SHA256(order_id + "|" + payment_id, key secret), compared in constant time. */
export function razorpaySignatureValid(orderId: string, paymentId: string, signature: string, keySecret: string): boolean {
  const expected = createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The captured payment on an order, in the shape claimPaid stores. */
export function capturedPayment(payments: unknown[]): PaymentSummary | null {
  for (const raw of payments) {
    const p = raw as Record<string, unknown>;
    if (p["status"] !== "captured") continue;
    const card = p["card"] as { type?: string } | undefined;
    const method = String(p["method"] ?? "");
    const acquirer = (p["acquirer_data"] ?? {}) as Record<string, unknown>;
    const reference = acquirer["rrn"] ?? acquirer["upi_transaction_id"] ?? acquirer["bank_transaction_id"];
    return {
      cfPaymentId: String(p["id"] ?? ""),
      paymentStatus: "SUCCESS",
      // methodLabel() already reads Cashfree's group names.
      paymentGroup:
        method === "card" ? (card?.type === "credit" ? "credit_card" : "debit_card") : method === "netbanking" ? "net_banking" : method || null,
      bankReference: typeof reference === "string" ? reference : null,
      amountPaise: typeof p["amount"] === "number" ? p["amount"] : null,
      paidAt: typeof p["created_at"] === "number" ? new Date(p["created_at"] * 1000) : null,
    };
  }
  return null;
}
