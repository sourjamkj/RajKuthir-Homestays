import { logger } from "./logger";
import { ownerEmail, sendEmail } from "./book-pay-notify";
import { alertFor, runInvoiceSelfCheck, type SelfCheckResult } from "./invoice-selfcheck-core";
import { upiDetails } from "./whatsapp-templates";

/**
 * The invoice self-check: every hour the server makes a test invoice and a
 * test booking confirmation (with its UPI QR) from a made-up booking, exactly
 * as it would for a guest, and keeps the result.
 *
 * - GET /api/health/invoices shows the last result. It carries no guest data —
 *   the booking is fictional — so it is public, and anyone (or any monitor)
 *   can see whether PDFs are working without signing in.
 * - When the check starts failing, the owner gets one email with the error;
 *   when it works again, one more. Nothing is sent while the state is steady,
 *   and nothing ever goes to WhatsApp.
 * - The console shows a red bar while it is failing.
 */

let last: SelfCheckResult | null = null;

/** The latest result, running the check first if there is none yet or it is over 10 minutes old. */
export async function invoiceHealth(now = new Date()): Promise<SelfCheckResult> {
  if (!last || now.getTime() - Date.parse(last.checkedAt) > 10 * 60_000) {
    // Concurrent requests share one run rather than each making PDFs.
    running ??= checkAndAlert(now).finally(() => {
      running = null;
    });
    await running;
  }
  return last!;
}

let running: Promise<void> | null = null;

async function checkAndAlert(now = new Date()): Promise<void> {
  const previous = last;
  const next = await runInvoiceSelfCheck(now, upiDetails() ?? undefined);
  last = next;
  if (!next.ok) logger.error({ steps: next.steps }, "Invoice self-check failed");
  const alert = alertFor(previous, next);
  if (!alert) return;
  const to = await ownerEmail();
  const sent = await sendEmail(to, alert.subject, alert.text);
  logger.info({ sent, subject: alert.subject }, "Invoice self-check alert");
}

let started = false;

export function startInvoiceSelfCheck(): void {
  if (started) return;
  started = true;
  setTimeout(() => void checkAndAlert(), 60_000).unref?.();
  setInterval(() => void checkAndAlert(), 60 * 60_000).unref?.();
}
