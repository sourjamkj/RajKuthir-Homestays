import { logger } from "./logger";
import { runMailSync } from "./mail-runner";

/**
 * Reads the mailboxes on a timer, in step with the calendar poller beside it.
 *
 * Every 15 minutes. This used to be two hours on the reasoning that the iCal
 * feeds block the dates anyway — but Booking.com's feed lags its emails by
 * hours, and its "New booking!" email is now parsed into a booking that
 * blocks the night on the website. One IMAP check every 15 minutes is well
 * inside what Gmail and Yahoo tolerate; a few minutes would not be.
 */

let started = false;
const POLL_INTERVAL_MS = 15 * 60 * 1000;

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
