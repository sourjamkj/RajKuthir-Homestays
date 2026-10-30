import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The rules for paying a Book & Pay advance online through Cashfree, with no
 * network or database in them. Tested by cashfree-rules.test.ts.
 *
 * cashfree-client.ts does the HTTP, cashfree-repo.ts the database and
 * cashfree-service.ts puts them together. None re-implements a rule.
 */

export const CASHFREE_API_VERSION = "2025-01-01";

export type CashfreeEnv = "sandbox" | "production";

export type CashfreeConfig = {
  env: CashfreeEnv;
  appId: string;
  secretKey: string;
  /** Key for webhook signatures. Cashfree signs payment webhooks with the secret key. */
  webhookKey: string;
  baseUrl: string;
};

/**
 * Online payment is on only when both keys are set. CASHFREE_ENV must say
 * "production" in so many words to touch real money; anything else is the
 * sandbox.
 */
export function readCashfreeConfig(env: Record<string, string | undefined>): CashfreeConfig | null {
  const appId = env["CASHFREE_APP_ID"]?.trim();
  const secretKey = env["CASHFREE_SECRET_KEY"]?.trim();
  if (!appId || !secretKey) return null;
  const mode: CashfreeEnv = env["CASHFREE_ENV"]?.trim().toLowerCase() === "production" ? "production" : "sandbox";
  return {
    env: mode,
    appId,
    secretKey,
    webhookKey: env["CASHFREE_WEBHOOK_SECRET"]?.trim() || secretKey,
    baseUrl: mode === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg",
  };
}

/** Paise to the rupee number Cashfree's order_amount expects. */
export function rupeesFromPaise(paise: number): number {
  return Math.round(paise) / 100;
}

/** Cashfree's rupee amount back to paise, without float drift. */
export function paiseFromRupees(rupees: unknown): number | null {
  const value = typeof rupees === "string" ? Number(rupees) : rupees;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/**
 * Our order_id at Cashfree: the booking reference plus the attempt number.
 * Cashfree allows letters, digits, "_" and "-" and wants it unique per order.
 */
export function orderIdFor(reference: string, attempt: number): string {
  const safe = reference.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40);
  return `${safe}-${attempt}`;
}

export function looksLikeOrderId(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{3,50}$/.test(raw);
}

/** Cashfree takes ISO 8601 with an offset; IST reads naturally in their dashboard. */
export function istIso(at: Date): string {
  const shifted = new Date(at.getTime() + 330 * 60_000);
  return `${shifted.toISOString().slice(0, 19)}+05:30`;
}

/** Shortest checkout window we open. Cashfree refuses very short expiries. */
export const MIN_CHECKOUT_MINUTES = 20;

/**
 * When the online order should expire, and how long the dates must stay held
 * for it. The guest is never sent to a checkout that outlives their hold:
 * the hold is stretched to cover the checkout instead, so a payment made in
 * time can never land on dates that were released under it.
 */
export function checkoutWindow(holdExpiresAt: Date, now: Date): { orderExpiresAt: Date; holdExpiresAt: Date } {
  const floor = new Date(now.getTime() + MIN_CHECKOUT_MINUTES * 60_000);
  const orderExpiresAt = holdExpiresAt.getTime() > floor.getTime() ? holdExpiresAt : floor;
  return { orderExpiresAt, holdExpiresAt: orderExpiresAt };
}

/* ----------------------------- webhooks -------------------------------- */

/** Webhooks older (or newer) than this are refused as possible replays. */
export const WEBHOOK_TOLERANCE_MS = 5 * 60_000;

/**
 * Cashfree signs a webhook as base64(HMAC-SHA256(timestamp + raw body)).
 * The raw bytes, never re-serialised JSON: one changed space breaks it.
 */
export function webhookSignature(timestamp: string, rawBody: Buffer | string, key: string): string {
  return createHmac("sha256", key)
    .update(timestamp)
    .update(rawBody)
    .digest("base64");
}

export type WebhookCheck = { ok: true } | { ok: false; reason: "missing" | "stale" | "mismatch" };

export function verifyWebhook(input: {
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: Buffer | undefined;
  key: string;
  now: Date;
}): WebhookCheck {
  const { timestamp, signature, rawBody, key, now } = input;
  if (!timestamp || !signature || !rawBody) return { ok: false, reason: "missing" };

  // Cashfree sends milliseconds; accept seconds too rather than guess wrong.
  const stamp = Number(timestamp);
  if (!Number.isFinite(stamp)) return { ok: false, reason: "stale" };
  const millis = stamp < 1e12 ? stamp * 1000 : stamp;
  if (Math.abs(now.getTime() - millis) > WEBHOOK_TOLERANCE_MS) return { ok: false, reason: "stale" };

  const expected = Buffer.from(webhookSignature(timestamp, rawBody, key));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}

/** The order_id inside any payment webhook, wherever this version puts it. */
export function orderIdFromWebhook(body: unknown): string | null {
  const data = (body as { data?: { order?: { order_id?: unknown } } } | null)?.data;
  const id = data?.order?.order_id;
  return looksLikeOrderId(id) ? id : null;
}

/* --------------------------- order outcomes ---------------------------- */

export type CashfreeOrderStatus = "ACTIVE" | "PAID" | "EXPIRED" | "TERMINATED" | "TERMINATION_REQUESTED";

export type PaymentSummary = {
  cfPaymentId: string;
  paymentStatus: string;
  paymentGroup: string | null;
  bankReference: string | null;
  amountPaise: number | null;
  paidAt: Date | null;
};

/** The one successful payment in Cashfree's list for an order, if there is one. */
export function successfulPayment(payments: unknown): PaymentSummary | null {
  if (!Array.isArray(payments)) return null;
  for (const raw of payments) {
    const p = raw as Record<string, unknown>;
    if (p["payment_status"] !== "SUCCESS") continue;
    const when = typeof p["payment_completion_time"] === "string" ? p["payment_completion_time"] : p["payment_time"];
    const paidAt = typeof when === "string" && !Number.isNaN(Date.parse(when)) ? new Date(when) : null;
    return {
      cfPaymentId: String(p["cf_payment_id"] ?? ""),
      paymentStatus: "SUCCESS",
      paymentGroup: typeof p["payment_group"] === "string" ? p["payment_group"] : null,
      bankReference: typeof p["bank_reference"] === "string" ? p["bank_reference"] : null,
      amountPaise: paiseFromRupees(p["payment_amount"]),
      paidAt,
    };
  }
  return null;
}

export type Settlement =
  | { kind: "paid" }
  | { kind: "amount_mismatch"; expectedPaise: number; gotPaise: number | null }
  | { kind: "pending" }
  | { kind: "closed"; status: CashfreeOrderStatus };

/**
 * What a fetched order means for us. PAID only counts when the amount is
 * exactly the advance we asked for: a mismatch is never auto-confirmed.
 */
export function settlementFor(order: { order_status?: unknown; order_amount?: unknown }, expectedPaise: number): Settlement {
  const status = String(order.order_status ?? "ACTIVE") as CashfreeOrderStatus;
  if (status === "PAID") {
    const got = paiseFromRupees(order.order_amount);
    return got === expectedPaise ? { kind: "paid" } : { kind: "amount_mismatch", expectedPaise, gotPaise: got };
  }
  if (status === "EXPIRED" || status === "TERMINATED" || status === "TERMINATION_REQUESTED") {
    return { kind: "closed", status };
  }
  return { kind: "pending" };
}

/** Plain words for the payment method, for the owner and the guest. */
export function methodLabel(group: string | null): string {
  switch (group) {
    case "upi":
      return "UPI";
    case "credit_card":
      return "Credit card";
    case "debit_card":
      return "Debit card";
    case "net_banking":
      return "Net banking";
    case "wallet":
      return "Wallet";
    case null:
    case "":
      return "Online";
    default:
      return group.replace(/_/g, " ");
  }
}

/* ------------------------------ refunds -------------------------------- */

/** Refund statuses that still count against what can be refunded. */
const LIVE_REFUND = new Set(["SUCCESS", "PENDING", "PENDING_APPROVAL", "ONHOLD"]);

export function refundablePaise(paidPaise: number, refunds: Array<{ amountPaise: number; status: string }>): number {
  const used = refunds.filter((r) => LIVE_REFUND.has(r.status)).reduce((sum, r) => sum + r.amountPaise, 0);
  return Math.max(0, paidPaise - used);
}

export function refundProblem(amountPaise: unknown, refundable: number): string | null {
  if (typeof amountPaise !== "number" || !Number.isInteger(amountPaise) || amountPaise < 100) {
    return "Enter a refund of at least ₹1.";
  }
  if (refundable <= 0) return "Everything paid online has already been refunded.";
  if (amountPaise > refundable) return `At most ₹${(refundable / 100).toFixed(2)} can be refunded.`;
  return null;
}

export function refundIdFor(reference: string, n: number): string {
  return `RF-${reference.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 36)}-${n}`;
}

export const REFUND_PENDING = new Set(["PENDING", "PENDING_APPROVAL", "ONHOLD"]);
