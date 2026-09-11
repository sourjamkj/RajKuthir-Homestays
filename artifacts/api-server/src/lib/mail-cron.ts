import { logger } from "./logger";
import { runMailSync } from "./mail-runner";

/**
 * Reads the mailboxes on a timer, in step with the calendar poller beside it.
 *
 * Two hours rather than minutes: OTA vouchers arrive within seconds of a
 * booking, but nothing downstream is time-critical — the calendar already
 * blocks the dates from the iCal feeds, and this is what fills in the money
 * and the guest name. Hammering an IMAP server every few minutes is how a
 * provider starts rate-limiting the connection.
 */

let started = false;
const POLL_INTERVAL_MS = 2 * 60 * 60 * 1000;

export function startMailCron(): void {
  if (started) return;
  started = true;

  const poll = () => {
    runMailSync().catch((error) => {
      logger.error({ err: error }, "Mailbox polling failed unexpectedly");
    });
  };

  const interval = setInterval(poll, POLL_INTERVAL_MS);
  // Never hold the process open for a poll: a deploy should not wait on it.
  interval.unref?.();

  // Not at boot. The first thing a restarted server should do is serve the
  // page someone is waiting for, not open IMAP connections.
  setTimeout(poll, 45_000);

  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Mailbox polling scheduled");
}
