import { and, asc, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import {
  db,
  gatewayOrders,
  gatewayRefunds,
  paymentRequests,
  type GatewayOrder,
  type GatewayRefund,
  type PaymentRequest,
} from "@workspace/db";

import { extendedHold } from "./book-pay-rules";
import type { PaymentSummary } from "./cashfree-rules";

/** Database side of online payment. Decisions live in cashfree-rules.ts. */

export async function nextAttempt(paymentRequestId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(gatewayOrders)
    .where(eq(gatewayOrders.paymentRequestId, paymentRequestId));
  return (row?.n ?? 0) + 1;
}

export async function insertOrder(input: {
  paymentRequestId: string;
  orderId: string;
  cfOrderId: string | null;
  amountPaise: number;
  expiresAt: Date;
}): Promise<GatewayOrder> {
  const [row] = await db.insert(gatewayOrders).values({ ...input, status: "ACTIVE" }).returning();
  return row!;
}

export async function findOrder(orderId: string): Promise<GatewayOrder | null> {
  const [row] = await db.select().from(gatewayOrders).where(eq(gatewayOrders.orderId, orderId)).limit(1);
  return row ?? null;
}

/**
 * Records the payment and claims the order in one conditional UPDATE. Only
 * the first caller (webhook, return page or reconciler) gets the row back,
 * so only one of them goes on to confirm the booking.
 */
export async function claimPaid(
  orderId: string,
  payment: PaymentSummary | null,
  raw: unknown,
  now = new Date(),
): Promise<GatewayOrder | null> {
  const [row] = await db
    .update(gatewayOrders)
    .set({
      status: "PAID",
      cfPaymentId: payment?.cfPaymentId ?? null,
      paymentGroup: payment?.paymentGroup ?? null,
      bankReference: payment?.bankReference ?? null,
      paidAt: payment?.paidAt ?? now,
      raw: raw as object,
      updatedAt: now,
    })
    .where(and(eq(gatewayOrders.orderId, orderId), ne(gatewayOrders.status, "PAID")))
    .returning();
  return row ?? null;
}

export async function setOrderStatus(orderId: string, status: string, now = new Date()): Promise<void> {
  await db
    .update(gatewayOrders)
    .set({ status, updatedAt: now })
    .where(and(eq(gatewayOrders.orderId, orderId), ne(gatewayOrders.status, "PAID")));
}

export async function markSettled(id: string, note: string, now = new Date()): Promise<void> {
  await db.update(gatewayOrders).set({ settledAt: now, settleNote: note.slice(0, 500), updatedAt: now }).where(eq(gatewayOrders.id, id));
}

export async function paidOrderFor(paymentRequestId: string): Promise<GatewayOrder | null> {
  const [row] = await db
    .select()
    .from(gatewayOrders)
    .where(and(eq(gatewayOrders.paymentRequestId, paymentRequestId), eq(gatewayOrders.status, "PAID")))
    .orderBy(desc(gatewayOrders.paidAt))
    .limit(1);
  return row ?? null;
}

/** Orders still open at Cashfree, worth asking about: the webhook may have been missed. */
export async function ordersToReconcile(now = new Date()): Promise<GatewayOrder[]> {
  const settleAfter = new Date(now.getTime() - 3 * 60_000);
  const since = new Date(now.getTime() - 48 * 3_600_000);
  const quietFor = new Date(now.getTime() - 2 * 60_000);
  return db
    .select()
    .from(gatewayOrders)
    .where(
      sql`(
        (${gatewayOrders.status} = 'ACTIVE' and ${gatewayOrders.createdAt} >= ${since} and ${gatewayOrders.updatedAt} <= ${quietFor})
        or (${gatewayOrders.status} = 'PAID' and ${gatewayOrders.settledAt} is null and ${gatewayOrders.updatedAt} <= ${settleAfter})
      )`,
    )
    .orderBy(asc(gatewayOrders.createdAt))
    .limit(25);
}

/** Paid online: the dates stay held until the booking is made or the owner decides. */
export async function markRequestPaidOnline(paymentRequestId: string, now = new Date()): Promise<PaymentRequest | null> {
  const [current] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, paymentRequestId)).limit(1);
  if (!current) return null;
  if (current.status !== "awaiting_payment" && current.status !== "expired") return current;
  const [updated] = await db
    .update(paymentRequests)
    .set({ status: "submitted", holdExpiresAt: extendedHold(current.holdExpiresAt, now), decidedAt: null, updatedAt: now })
    .where(and(eq(paymentRequests.id, paymentRequestId), inArray(paymentRequests.status, ["awaiting_payment", "expired"])))
    .returning();
  return updated ?? current;
}

/** Stretches a waiting hold so it covers the online checkout. Never shortens it. */
export async function stretchHold(paymentRequestId: string, until: Date, now = new Date()): Promise<boolean> {
  const updated = await db
    .update(paymentRequests)
    .set({ holdExpiresAt: sql`greatest(${paymentRequests.holdExpiresAt}, ${until})`, updatedAt: now })
    .where(
      and(
        eq(paymentRequests.id, paymentRequestId),
        eq(paymentRequests.status, "awaiting_payment"),
        gte(paymentRequests.holdExpiresAt, now),
      ),
    )
    .returning({ id: paymentRequests.id });
  return updated.length > 0;
}

/* ------------------------------- refunds ------------------------------- */

export async function refundsFor(gatewayOrderId: string): Promise<GatewayRefund[]> {
  return db.select().from(gatewayRefunds).where(eq(gatewayRefunds.gatewayOrderId, gatewayOrderId)).orderBy(asc(gatewayRefunds.createdAt));
}

export async function insertRefund(input: {
  gatewayOrderId: string;
  refundId: string;
  cfRefundId: string | null;
  amountPaise: number;
  status: string;
  note: string | null;
  raw: unknown;
}): Promise<GatewayRefund> {
  const [row] = await db
    .insert(gatewayRefunds)
    .values({ ...input, raw: input.raw as object })
    .returning();
  return row!;
}

export async function updateRefund(refundId: string, status: string, raw: unknown, now = new Date()): Promise<void> {
  await db.update(gatewayRefunds).set({ status, raw: raw as object, updatedAt: now }).where(eq(gatewayRefunds.refundId, refundId));
}

export async function pendingRefunds(): Promise<Array<GatewayRefund & { orderId: string }>> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  return db
    .select({
      id: gatewayRefunds.id,
      gatewayOrderId: gatewayRefunds.gatewayOrderId,
      refundId: gatewayRefunds.refundId,
      cfRefundId: gatewayRefunds.cfRefundId,
      amountPaise: gatewayRefunds.amountPaise,
      status: gatewayRefunds.status,
      note: gatewayRefunds.note,
      raw: gatewayRefunds.raw,
      createdAt: gatewayRefunds.createdAt,
      updatedAt: gatewayRefunds.updatedAt,
      orderId: gatewayOrders.orderId,
    })
    .from(gatewayRefunds)
    .innerJoin(gatewayOrders, eq(gatewayOrders.id, gatewayRefunds.gatewayOrderId))
    .where(and(inArray(gatewayRefunds.status, ["PENDING", "PENDING_APPROVAL", "ONHOLD"]), gte(gatewayRefunds.createdAt, since)))
    .limit(25);
}

/* -------------------------------- admin -------------------------------- */

export type AdminGatewayInfo = {
  orderId: string;
  amountPaise: number;
  paymentGroup: string | null;
  cfPaymentId: string | null;
  bankReference: string | null;
  paidAt: Date | null;
  settleNote: string | null;
  refunds: Array<{ refundId: string; amountPaise: number; status: string; note: string | null; createdAt: Date }>;
};

/** The paid online order (and its refunds) for each request that has one. */
export async function gatewayInfoFor(paymentRequestIds: string[]): Promise<Map<string, AdminGatewayInfo>> {
  const out = new Map<string, AdminGatewayInfo>();
  if (!paymentRequestIds.length) return out;
  const paid = await db
    .select()
    .from(gatewayOrders)
    .where(and(inArray(gatewayOrders.paymentRequestId, paymentRequestIds), eq(gatewayOrders.status, "PAID")));
  if (!paid.length) return out;
  const refunds = await db
    .select()
    .from(gatewayRefunds)
    .where(inArray(gatewayRefunds.gatewayOrderId, paid.map((o) => o.id)))
    .orderBy(asc(gatewayRefunds.createdAt));
  for (const order of paid) {
    out.set(order.paymentRequestId, {
      orderId: order.orderId,
      amountPaise: order.amountPaise,
      paymentGroup: order.paymentGroup,
      cfPaymentId: order.cfPaymentId,
      bankReference: order.bankReference,
      paidAt: order.paidAt,
      settleNote: order.settleNote,
      refunds: refunds
        .filter((r) => r.gatewayOrderId === order.id)
        .map((r) => ({ refundId: r.refundId, amountPaise: r.amountPaise, status: r.status, note: r.note, createdAt: r.createdAt })),
    });
  }
  return out;
}

