import { logger } from "./logger";
import { SITE_ORIGIN } from "./seo";
import { findById, logPaymentEvent, type RequestWithEnquiry } from "./book-pay-repo";
import { confirmPaymentRequest } from "./book-pay-confirm";
import { ownerOnlinePaymentAlert } from "./book-pay-messages";
import { ownerEmail, sendEmail, sendWhatsappTemplate } from "./book-pay-notify";
import { holdBlocks } from "./book-pay-rules";
import { normaliseMobile } from "./phone";
import {
  cashfreeConfig,
  createOrder,
  createRefund,
  getOrder,
  getOrderPayments,
  getRefund,
} from "./cashfree-client";
import {
  checkoutWindow,
  istIso,
  methodLabel,
  orderIdFor,
  paiseFromRupees,
  refundIdFor,
  refundProblem,
  refundablePaise,
  rupeesFromPaise,
  settlementFor,
  successfulPayment,
  type CashfreeEnv,
} from "./cashfree-rules";
import {
  claimPaid,
  findOrder,
  insertOrder,
  insertRefund,
  markRequestPaidOnline,
  markSettled,
  nextAttempt,
  ordersToReconcile,
  paidOrderFor,
  pendingRefunds,
  refundsFor,
  setOrderStatus,
  stretchHold,
  updateRefund,
} from "./cashfree-repo";

/**
 * Online payment of a Book & Pay advance, end to end:
 *
 *   startCheckout   guest presses "Pay online" → a Cashfree order + session
 *   settleOrder     webhook, return page or reconciler: ask Cashfree what
 *                   happened; if PAID for the right amount, make the booking
 *   refund          owner refunds from the console
 *
 * Cashfree's word is only ever taken from Cashfree's own API, fetched with
 * our secret key. A webhook or a return URL is a nudge to go and ask, never
 * proof of payment on its own.
 */

export function onlinePaymentMode(): CashfreeEnv | null {
  return cashfreeConfig()?.env ?? null;
}

export type CheckoutResult =
  | { ok: true; paymentSessionId: string; orderId: string; mode: CashfreeEnv }
  | { ok: false; status: number; error: string };

export async function startCheckout(found: RequestWithEnquiry, now = new Date()): Promise<CheckoutResult> {
  const config = cashfreeConfig();
  if (!config) return { ok: false, status: 503, error: "Online payment is not switched on yet. Please pay by UPI below." };

  const { request, enquiry } = found;
  if (request.status !== "awaiting_payment" || !holdBlocks(request, now)) {
    return { ok: false, status: 410, error: "This booking is no longer waiting for payment. Please refresh the page." };
  }

  const phone = normaliseMobile(enquiry.phone ?? "");
  if (!phone) return { ok: false, status: 400, error: "We need a valid mobile number on the booking to take an online payment. Please call us." };

  // Never send the guest into a checkout that outlives their hold.
  const window = checkoutWindow(request.holdExpiresAt, now);
  if (window.holdExpiresAt.getTime() > request.holdExpiresAt.getTime()) {
    const stretched = await stretchHold(request.id, window.holdExpiresAt, now);
    if (!stretched) return { ok: false, status: 410, error: "This hold has just expired. Please start the booking again." };
  }

  const attempt = await nextAttempt(request.id);
  const orderId = orderIdFor(request.reference, attempt);
  const digits = phone.replace(/\D/g, "").slice(-10);

  const created = await createOrder(config, {
    orderId,
    amountRupees: rupeesFromPaise(request.advancePaise),
    customer: {
      id: `guest_${request.id.replace(/-/g, "").slice(0, 24)}`,
      name: enquiry.name.slice(0, 100),
      phone: digits,
      email: enquiry.email,
    },
    returnUrl: `${SITE_ORIGIN}/pay?order_id={order_id}`,
    notifyUrl: `${SITE_ORIGIN}/api/book/cashfree/webhook`,
    expiresAtIso: istIso(window.orderExpiresAt),
    note: `Advance ${request.reference} ${enquiry.checkIn ?? ""} to ${enquiry.checkOut ?? ""}`,
    tags: { reference: request.reference },
  });

  await insertOrder({
    paymentRequestId: request.id,
    orderId,
    cfOrderId: created.cf_order_id != null ? String(created.cf_order_id) : null,
    amountPaise: request.advancePaise,
    expiresAt: window.orderExpiresAt,
  });
  await logPaymentEvent(request.id, "online_checkout", `Cashfree order ${orderId}`);

  return { ok: true, paymentSessionId: created.payment_session_id, orderId, mode: config.env };
}

export type SettleResult = {
  status: "unknown" | "pending" | "paid" | "closed" | "mismatch";
  /** True when this call (not an earlier one) made the booking. */
  confirmedNow?: boolean;
  paymentRequestId?: string;
};

/**
 * Asks Cashfree about one order and acts on the answer. Safe to call any
 * number of times from any number of places: claimPaid lets exactly one
 * caller go on to confirm.
 */
export async function settleOrder(orderId: string, source: string, now = new Date()): Promise<SettleResult> {
  const config = cashfreeConfig();
  const row = await findOrder(orderId);
  if (!config || !row) return { status: "unknown" };

  // Paid earlier but the booking step never finished (crash, deploy): finish it.
  if (row.status === "PAID") {
    if (!row.settledAt) await finishPaid(row.id, row.paymentRequestId, row.amountPaise, row.paymentGroup, row.cfPaymentId, `${source} (retry)`);
    return { status: "paid", paymentRequestId: row.paymentRequestId };
  }

  const order = await getOrder(config, orderId);
  const outcome = settlementFor(order, row.amountPaise);

  if (outcome.kind === "pending") return { status: "pending", paymentRequestId: row.paymentRequestId };

  if (outcome.kind === "closed") {
    await setOrderStatus(orderId, outcome.status, now);
    return { status: "closed", paymentRequestId: row.paymentRequestId };
  }

  const payments = await getOrderPayments(config, orderId).catch(() => []);
  const payment = successfulPayment(payments);
  const claimed = await claimPaid(orderId, payment, { order, payment }, now);
  if (!claimed) return { status: "paid", paymentRequestId: row.paymentRequestId };

  if (outcome.kind === "amount_mismatch") {
    const problem = `Cashfree reports ₹${((outcome.gotPaise ?? 0) / 100).toFixed(2)} paid, but the advance was ₹${(outcome.expectedPaise / 100).toFixed(2)}.`;
    logger.error({ orderId, expected: outcome.expectedPaise, got: outcome.gotPaise }, "Cashfree amount mismatch");
    await markRequestPaidOnline(row.paymentRequestId, now);
    await logPaymentEvent(row.paymentRequestId, "paid_online", `Cashfree ${orderId}: amount mismatch`);
    await markSettled(claimed.id, problem, now);
    await alertOwner(row.paymentRequestId, claimed.amountPaise, claimed.paymentGroup, claimed.cfPaymentId, false, problem);
    return { status: "mismatch", paymentRequestId: row.paymentRequestId };
  }

  const confirmedNow = await finishPaid(
    claimed.id,
    row.paymentRequestId,
    row.amountPaise,
    claimed.paymentGroup,
    claimed.cfPaymentId,
    source,
  );
  return { status: "paid", confirmedNow, paymentRequestId: row.paymentRequestId };
}

/** Records the payment on the request and makes the booking. Returns whether it was made. */
async function finishPaid(
  gatewayOrderId: string,
  paymentRequestId: string,
  amountPaise: number,
  paymentGroup: string | null,
  cfPaymentId: string | null,
  source: string,
): Promise<boolean> {
  const method = methodLabel(paymentGroup);
  await markRequestPaidOnline(paymentRequestId);
  await logPaymentEvent(paymentRequestId, "paid_online", `${method} via Cashfree${cfPaymentId ? ` (payment ${cfPaymentId})` : ""}, seen by ${source}`);

  const found = await findById(paymentRequestId);
  if (!found) {
    await markSettled(gatewayOrderId, "Payment request no longer exists");
    return false;
  }

  if (found.request.status === "confirmed") {
    await markSettled(gatewayOrderId, "Already confirmed");
    return false;
  }

  try {
    const outcome = await confirmPaymentRequest(found, { eventDetail: `paid online (${method})` });
    if (outcome.ok) {
      await markSettled(gatewayOrderId, `Booked ${outcome.body.booking.reference}; confirmation: ${outcome.body.deliverySummary}`);
      await alertOwner(
        paymentRequestId,
        amountPaise,
        paymentGroup,
        cfPaymentId,
        true,
        outcome.body.confirmationDelivered
          ? null
          : `Booked, but the confirmation PDF did not reach the guest (${outcome.body.deliverySummary}). Tap Share on the Confirmation PDF in Guests.`,
      );
      logger.info({ paymentRequestId }, "Book & Pay confirmed automatically after online payment");
      return true;
    }
    const problem = String(outcome.body["error"] ?? "The booking could not be made automatically.");
    await markSettled(gatewayOrderId, problem);
    await alertOwner(paymentRequestId, amountPaise, paymentGroup, cfPaymentId, false, problem);
    return false;
  } catch (error) {
    // Left unsettled on purpose: the reconciler tries again in a few minutes.
    logger.error({ err: error, paymentRequestId }, "Automatic confirmation after online payment failed");
    return false;
  }
}

async function alertOwner(
  paymentRequestId: string,
  amountPaise: number,
  paymentGroup: string | null,
  cfPaymentId: string | null,
  confirmed: boolean,
  problem: string | null,
): Promise<void> {
  try {
    const found = await findById(paymentRequestId);
    if (!found) return;
    const alert = ownerOnlinePaymentAlert({
      guestName: found.enquiry.name,
      guestPhone: found.enquiry.phone,
      reference: found.request.reference,
      checkIn: found.enquiry.checkIn,
      checkOut: found.enquiry.checkOut,
      amountPaise,
      method: methodLabel(paymentGroup),
      cfPaymentId,
      confirmed,
      problem,
      adminUrl: `${SITE_ORIGIN}/admin/guests#payments`,
    });
    await sendEmail(await ownerEmail(), alert.subject, alert.text);
    await sendWhatsappTemplate(process.env["OWNER_WHATSAPP_NUMBER"], "WHATSAPP_OWNER_ALERT_TEMPLATE", [
      found.enquiry.name,
      `₹${amountPaise / 100}`,
      `Cashfree ${cfPaymentId ?? methodLabel(paymentGroup)}`,
      found.request.reference,
    ]);
  } catch (error) {
    logger.error({ err: error, paymentRequestId }, "Could not alert the owner about an online payment");
  }
}

/* ------------------------------ reconcile ------------------------------ */

let reconciling = false;

/**
 * Every few minutes: ask Cashfree about open orders (in case a webhook never
 * arrived), finish any paid order whose booking step was interrupted, and
 * refresh pending refunds. Never throws.
 */
export async function reconcileOnlinePayments(now = new Date()): Promise<void> {
  if (reconciling || !cashfreeConfig()) return;
  reconciling = true;
  try {
    for (const order of await ordersToReconcile(now)) {
      try {
        const result = await settleOrder(order.orderId, "reconciler", now);
        // Past its expiry and still unpaid at Cashfree: stop asking.
        if (result.status === "pending" && order.expiresAt.getTime() + 30 * 60_000 < now.getTime()) {
          await setOrderStatus(order.orderId, "EXPIRED", now);
        }
      } catch (error) {
        logger.warn({ err: error, orderId: order.orderId }, "Could not reconcile a Cashfree order");
      }
    }

    const config = cashfreeConfig();
    if (!config) return;
    for (const refund of await pendingRefunds()) {
      try {
        const fresh = await getRefund(config, refund.orderId, refund.refundId);
        if (fresh.refund_status !== refund.status) await updateRefund(refund.refundId, fresh.refund_status, fresh, now);
      } catch (error) {
        logger.warn({ err: error, refundId: refund.refundId }, "Could not refresh a Cashfree refund");
      }
    }
  } catch (error) {
    logger.error({ err: error }, "Online payment reconciliation failed");
  } finally {
    reconciling = false;
  }
}

/* ------------------------------- refunds ------------------------------- */

export type RefundOutcome = { ok: true; refundId: string; status: string } | { ok: false; status: number; error: string };

export async function refundOnline(paymentRequestId: string, amountPaise: unknown, note: string | null): Promise<RefundOutcome> {
  const config = cashfreeConfig();
  if (!config) return { ok: false, status: 503, error: "Cashfree is not configured." };

  const found = await findById(paymentRequestId);
  const order = await paidOrderFor(paymentRequestId);
  if (!found || !order) return { ok: false, status: 404, error: "There is no online payment on this booking to refund." };

  const existing = await refundsFor(order.id);
  const refundable = refundablePaise(order.amountPaise, existing);
  const problem = refundProblem(amountPaise, refundable);
  if (problem) return { ok: false, status: 400, error: problem };

  const amount = amountPaise as number;
  const refundId = refundIdFor(found.request.reference, existing.length + 1);
  const result = await createRefund(config, {
    orderId: order.orderId,
    refundId,
    amountRupees: rupeesFromPaise(amount),
    note: note || `Refund ${found.request.reference}`,
  });

  await insertRefund({
    gatewayOrderId: order.id,
    refundId,
    cfRefundId: result.cf_refund_id != null ? String(result.cf_refund_id) : null,
    amountPaise: paiseFromRupees(result.refund_amount) ?? amount,
    status: result.refund_status ?? "PENDING",
    note,
    raw: result,
  });
  await logPaymentEvent(paymentRequestId, "refund", `₹${(amount / 100).toFixed(2)} via Cashfree (${refundId})${note ? `: ${note}` : ""}`);
  return { ok: true, refundId, status: result.refund_status ?? "PENDING" };
}
