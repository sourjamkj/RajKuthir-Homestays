import { CASHFREE_API_VERSION, readCashfreeConfig, type CashfreeConfig } from "./cashfree-rules";
import { logger } from "./logger";

/**
 * The few Cashfree Payment Gateway calls Book & Pay needs, over plain fetch.
 * Keys come from the environment and never leave the server.
 */

export function cashfreeConfig(): CashfreeConfig | null {
  return readCashfreeConfig(process.env);
}

export class CashfreeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
}

async function call<T>(
  config: CashfreeConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: {
      "x-client-id": config.appId,
      "x-client-secret": config.secretKey,
      "x-api-version": CASHFREE_API_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const info = (parsed ?? {}) as { message?: string; code?: string };
    // Never log the request: it carries the guest's phone and email.
    logger.warn({ status: response.status, code: info.code, path: path.split("/").slice(0, 3).join("/") }, "Cashfree call failed");
    throw new CashfreeError(info.message ?? `Cashfree answered ${response.status}`, response.status, info.code ?? null);
  }
  return parsed as T;
}

export type CreatedOrder = {
  cf_order_id?: string | number;
  order_id: string;
  order_status: string;
  order_amount: number;
  payment_session_id: string;
};

export function createOrder(
  config: CashfreeConfig,
  input: {
    orderId: string;
    amountRupees: number;
    customer: { id: string; name: string; phone: string; email: string | null };
    returnUrl: string;
    notifyUrl: string;
    expiresAtIso: string;
    note: string;
    tags: Record<string, string>;
  },
): Promise<CreatedOrder> {
  return call<CreatedOrder>(
    config,
    "POST",
    "/orders",
    {
      order_id: input.orderId,
      order_amount: input.amountRupees,
      order_currency: "INR",
      customer_details: {
        customer_id: input.customer.id,
        customer_name: input.customer.name,
        customer_phone: input.customer.phone,
        ...(input.customer.email ? { customer_email: input.customer.email } : {}),
      },
      order_meta: {
        return_url: input.returnUrl,
        notify_url: input.notifyUrl,
        // UPI, cards and net banking: the methods the 0% offer covers. No
        // pay-later or EMI, which carry their own fees.
        payment_methods: "upi,cc,dc,nb",
      },
      order_expiry_time: input.expiresAtIso,
      order_note: input.note.slice(0, 200),
      order_tags: input.tags,
    },
    input.orderId,
  );
}

export type FetchedOrder = {
  cf_order_id?: string | number;
  order_id: string;
  order_status: string;
  order_amount: number;
};

export function getOrder(config: CashfreeConfig, orderId: string): Promise<FetchedOrder> {
  return call<FetchedOrder>(config, "GET", `/orders/${encodeURIComponent(orderId)}`);
}

export function getOrderPayments(config: CashfreeConfig, orderId: string): Promise<unknown[]> {
  return call<unknown[]>(config, "GET", `/orders/${encodeURIComponent(orderId)}/payments`);
}

export type RefundResult = {
  cf_refund_id?: string | number;
  refund_id: string;
  refund_status: string;
  refund_amount: number;
};

export function createRefund(
  config: CashfreeConfig,
  input: { orderId: string; refundId: string; amountRupees: number; note: string },
): Promise<RefundResult> {
  return call<RefundResult>(
    config,
    "POST",
    `/orders/${encodeURIComponent(input.orderId)}/refunds`,
    { refund_amount: input.amountRupees, refund_id: input.refundId, refund_note: input.note.slice(0, 100) },
    input.refundId,
  );
}

export function getRefund(config: CashfreeConfig, orderId: string, refundId: string): Promise<RefundResult> {
  return call<RefundResult>(
    config,
    "GET",
    `/orders/${encodeURIComponent(orderId)}/refunds/${encodeURIComponent(refundId)}`,
  );
}
