import { logger } from "./logger";
import { setEnquiryStatus } from "./enquiries-repo";
import {
  expireDueHolds,
  expiredNotNotified,
  isNotMigrated,
  logPaymentEvent,
  markExpiryNotified,
} from "./book-pay-repo";
import { expiredMessage } from "./book-pay-messages";
import { sendEmail, sendWhatsappTemplate } from "./book-pay-notify";
import { SITE_ORIGIN } from "./seo";
import { reconcileOnlinePayments } from "./cashfree-service";

/**
 * Every five minutes: close unpaid Book & Pay holds whose time is up and tell
 * the guest once. Same shape as calendar-cron.ts.
 *
 * The DATES do not depend on this job. A hold blocks only while it is live
 * (book-pay-rules holdBlocks), worked out at read time, so if this never
 * runs the nights are still released on time. The job only tidies the record
 * and sends the polite message. Holds with a UTR are never touched: they
 * wait for the owner.
 */

const INTERVAL_MS = 5 * 60 * 1000;
let started = false;
let running = false;

export async function runBookPayExpiry(now = new Date()): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const closed = await expireDueHolds(now);
    for (const { request } of closed) {
      await setEnquiryStatus(request.enquiryId, "closed");
      await logPaymentEvent(request.id, "expired", "Hold ran out with no payment");
    }

    // Includes ones closed in an earlier run whose message failed to send.
    for (const { request, enquiry } of await expiredNotNotified()) {
      const message = expiredMessage({
        guestName: enquiry.name,
        checkIn: enquiry.checkIn,
        checkOut: enquiry.checkOut,
        rebookUrl: `${SITE_ORIGIN}/#booking`,
      });
      const sent =
        (await sendWhatsappTemplate(enquiry.phone, "WHATSAPP_HOLD_EXPIRED_TEMPLATE", [
          enquiry.name.split(/\s+/)[0] ?? "there",
          `${SITE_ORIGIN}/#booking`,
        ])) || (await sendEmail(enquiry.email, message.subject, message.text));

      if (sent) {
        await markExpiryNotified(request.id, now);
        await logPaymentEvent(request.id, "expiry_notified", "Sent automatically");
      }
      // Otherwise the console shows a one-tap WhatsApp button for it.
    }

    if (closed.length) logger.info({ released: closed.length }, "Book & Pay holds released");

    // Online payments: catch any webhook Cashfree failed to deliver.
    await reconcileOnlinePayments(now);
    return closed.length;
  } catch (error) {
    if (!isNotMigrated(error)) logger.error({ err: error }, "Book & Pay expiry run failed");
    return 0;
  } finally {
    running = false;
  }
}

export function startBookPayCron(): void {
  if (started) return;
  started = true;
  const interval = setInterval(() => void runBookPayExpiry(), INTERVAL_MS);
  interval.unref?.();
  setTimeout(() => void runBookPayExpiry(), 20_000).unref?.();
  logger.info({ intervalMs: INTERVAL_MS }, "Book & Pay expiry scheduled");
}
