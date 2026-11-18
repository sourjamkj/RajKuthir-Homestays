import { readRazorpayConfig, type RazorpayConfig } from "./razorpay-rules";
import { logger } from "./logger";

/**
 * Razorpay Standard Checkout, over plain fetch. When RAZORPAY_KEY_ID and
 * RAZORPAY_KEY_SECRET are set, Book & Pay takes online payments through
 * Razorpay instead of Cashfree. The secret never leaves the server; the key
 * id is public and goes to the browser to open the checkout.
 */

export function razorpayConfig(): RazorpayConfig | null {
  return readRazorpayConfig(process.env);
}

export class RazorpayError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(config: RazorpayConfig, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const parsed = (await response.json().catch(() => null)) as { error?: { description?: string; code?: string } } | null;
  if (!response.ok) {
    logger.warn({ status: response.status, code: parsed?.error?.code, path: path.split("/").slice(0, 2).join("/") }, "Razorpay call failed");
    throw new RazorpayError(parsed?.error?.description ?? `Razorpay answered ${response.status}`, response.status);
  }
  return parsed as T;
}

export type RazorpayOrder = { id: string; amount: number; amount_paid: number; currency: string; status: string };

export function createRazorpayOrder(
  config: RazorpayConfig,
  input: { amountPaise: number; receipt: string; notes: Record<string, string> },
): Promise<RazorpayOrder> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise < 100) {
    throw new RazorpayError("Razorpay needs at least ₹1 (100 paise).", 400);
  }
  return call(config, "POST", "/orders", {
    amount: input.amountPaise,
    currency: "INR",
    receipt: input.receipt.slice(0, 40),
    notes: input.notes,
  });
}

export function getRazorpayOrder(config: RazorpayConfig, id: string): Promise<RazorpayOrder> {
  return call(config, "GET", `/orders/${encodeURIComponent(id)}`);
}

export async function getRazorpayOrderPayments(config: RazorpayConfig, id: string): Promise<unknown[]> {
  const body = await call<{ items?: unknown[] }>(config, "GET", `/orders/${encodeURIComponent(id)}/payments`);
  return body.items ?? [];
}

export type RazorpayRefund = { id: string; amount: number; status: string };

export function createRazorpayRefund(
  config: RazorpayConfig,
  paymentId: string,
  input: { amountPaise: number; receipt: string; note: string },
): Promise<RazorpayRefund> {
  return call(config, "POST", `/payments/${encodeURIComponent(paymentId)}/refund`, {
    amount: input.amountPaise,
    receipt: input.receipt.slice(0, 40),
    notes: { note: input.note.slice(0, 250) },
  });
}

export function getRazorpayRefund(config: RazorpayConfig, refundId: string): Promise<RazorpayRefund> {
  return call(config, "GET", `/refunds/${encodeURIComponent(refundId)}`);
}
