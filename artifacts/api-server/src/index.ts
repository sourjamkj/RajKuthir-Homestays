import app from "./app";
import { logger } from "./lib/logger";
import { startCalendarCron } from "./lib/calendar-cron";
import { startNotificationsCron } from "./lib/notifications-cron";
import { startMailCron } from "./lib/mail-cron";
import { startCaretakerAlerts } from "./lib/caretaker-alerts";
import { scheduleBookingComBackfill, scheduleOtaDocumentBackfill } from "./lib/mail-runner";
import { startBookPayCron } from "./lib/book-pay-cron";
import { ensureBookPayTables } from "./lib/book-pay-migrate";
import { startReviewsCron } from "./lib/reviews-cron";
import { startBookingHygiene } from "./lib/booking-dedupe";
import { startInvoiceEmails } from "./lib/invoices";
import { startInvoiceSelfCheck } from "./lib/invoice-selfcheck";
import { runSchemaCheck } from "./lib/schema-check";
import { ensureWaInboundTables } from "./lib/wa-webhook";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Keep the OTA calendars in sync automatically. This was wired up in
  // calendar-cron.ts but never actually started, so imports only ever ran
  // when someone manually clicked "Sync calendars" in the admin UI — if
  // that didn't happen regularly, feeds went stale and OTAs could double-book.
  // Started unconditionally (not gated on NODE_ENV) so it runs no matter
  // what env vars the hosting platform sets at runtime.
  startCalendarCron();

  // Queues and sends guest WhatsApp messages. Idle unless WhatsApp is
  // configured, and never sends unless WHATSAPP_ENABLED is explicitly true.
  startNotificationsCron();

  // Reads OTA booking emails out of the configured mailboxes. Idle until a
  // mailbox is added in the admin screen, and skipped entirely when
  // MAIL_ENCRYPTION_KEY is unset, since the stored passwords cannot be
  // opened without it.
  startMailCron();

  // WhatsApp alerts to the caretaker (and the owner): new booking, the day
  // before check-in, the day before check-out. Idle without BLUETICKS_API_KEY.
  startCaretakerAlerts();

  // One-off: import every Booking.com email already in the mailbox (bookings,
  // guest names, cancellations). Skips itself once it has completed.
  scheduleBookingComBackfill();

  // One-off: file the PDFs (vouchers, statements) from OTA emails already in
  // the mailbox. New ones are filed by the mail sync as they arrive.
  scheduleOtaDocumentBackfill();

  // Releases unpaid Book & Pay holds and tells the guest. The dates free
  // themselves without it (holds are derived); this tidies and notifies.
  // Creates the Book & Pay tables if they are missing (additive, idempotent),
  // so online booking switches itself on with no hand-run SQL.
  void ensureBookPayTables();
  startBookPayCron();

  // WhatsApp inbound: creates wa_inbound_messages and wa_conversations
  // tables if missing. Additive, idempotent — like caretaker_alerts.
  void ensureWaInboundTables();

  // Google reviews: queues review-request drafts for stays that just ended
  // and drafts replies to new reviews. Creates its tables (and the WhatsApp
  // outbox, if missing) at boot. Never posts or sends without the owner.
  startReviewsCron();

  // One guest, one stay, one booking: merges exact duplicates (and the ones
  // the owner named), and releases unpaid bookings back to enquiries once
  // their hold has passed. At boot, then hourly.
  startBookingHygiene();

  // Guest invoices: emailed at noon on check-out day for our own bookings
  // once fully paid. Creates its table at boot (additive).
  startInvoiceEmails();

  // Hourly test invoice + confirmation PDF; emails the owner when PDFs start
  // failing and when they recover. Status at /api/health/invoices.
  startInvoiceSelfCheck();

  // Says in the log whether the database still matches the Drizzle schema.
  // Four production 500s in one day came from that drift, each invisible until
  // one particular query ran; this turns the next one into a line at boot.
  //
  // Deliberately after listening, and deliberately not awaited: the site is
  // already serving by now, and a schema warning must never delay or prevent
  // a boot. runSchemaCheck resolves rather than rejects, and the catch is
  // belt and braces.
  void runSchemaCheck().catch((error) => {
    logger.error({ err: error }, "Schema check failed unexpectedly");
  });
});
