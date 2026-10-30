import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { paymentRequests } from "./payments";

/**
 * Online payments for Book & Pay through Cashfree.
 *
 * Each row is one Cashfree order: one attempt by the guest to pay a payment
 * request's advance online. A request can have several (a guest who closes
 * the checkout and tries again gets a fresh order); at most one is ever PAID.
 *
 * New tables only, as with payments.ts: nothing that reads payment_requests
 * or enquiries changes, so this cannot break a query that already runs.
 */
export const gatewayOrders = pgTable(
  "gateway_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentRequestId: uuid("payment_request_id")
      .notNull()
      .references(() => paymentRequests.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("cashfree"),
    /** Our order_id at Cashfree: "<reference>-<attempt>". */
    orderId: text("order_id").notNull(),
    /** Cashfree's own id for the order. */
    cfOrderId: text("cf_order_id"),
    amountPaise: integer("amount_paise").notNull(),
    /** ACTIVE | PAID | EXPIRED | TERMINATED | TERMINATION_REQUESTED */
    status: text("status").notNull().default("ACTIVE"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    cfPaymentId: text("cf_payment_id"),
    /** upi | credit_card | debit_card | net_banking | … as Cashfree names it. */
    paymentGroup: text("payment_group"),
    bankReference: text("bank_reference"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** Set once the paid order has been turned into a booking (or handed to the owner). */
    settledAt: timestamp("settled_at", { withTimezone: true }),
    settleNote: text("settle_note"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("gateway_order_order_id_uniq").on(table.orderId),
    index("gateway_order_request_idx").on(table.paymentRequestId),
    index("gateway_order_status_idx").on(table.status),
  ],
);

export type GatewayOrder = typeof gatewayOrders.$inferSelect;

/** Refunds against a paid gateway order. Status is Cashfree's refund_status. */
export const gatewayRefunds = pgTable(
  "gateway_refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gatewayOrderId: uuid("gateway_order_id")
      .notNull()
      .references(() => gatewayOrders.id, { onDelete: "cascade" }),
    refundId: text("refund_id").notNull(),
    cfRefundId: text("cf_refund_id"),
    amountPaise: integer("amount_paise").notNull(),
    /** SUCCESS | PENDING | PENDING_APPROVAL | CANCELLED | ONHOLD | REJECTED */
    status: text("status").notNull().default("PENDING"),
    note: text("note"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("gateway_refund_refund_id_uniq").on(table.refundId),
    index("gateway_refund_order_idx").on(table.gatewayOrderId),
  ],
);

export type GatewayRefund = typeof gatewayRefunds.$inferSelect;
