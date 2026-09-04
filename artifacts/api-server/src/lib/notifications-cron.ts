import { logger } from "./logger";
import { runNotifications } from "./notifications";
import { isWhatsappConfigured } from "./whatsapp-client";

/**
 * Runs the scheduler and drains the outbox every 15 minutes. Frequent enough
 * that a confirmation feels prompt, rare enough that a stuck message backs
 * off rather than hammering the provider.
 *
 * Mirrors startCalendarCron: unref'd so it never holds the process open, and
 * every error is swallowed and logged, because a failed send must not take
 * the API server down with it.
 */

let started = false;
const POLL_INTERVAL_MS = 15 * 60 * 1000;

export function startNotificationsCron(): void {
  if (started) return;
  started = true;

  if (!isWhatsappConfigured()) {
    logger.info(
      "WhatsApp is not configured — notification scheduling is idle. " +
        "Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN to enable it.",
    );
    return;
  }

  const poll = () => {
    runNotifications()
      .then((result) => {
        if (result.attempted > 0) {
          logger.info(result, "WhatsApp outbox drained");
        }
      })
      .catch((error) => {
        logger.error({ err: error }, "Notification run failed unexpectedly");
      });
  };

  const interval = setInterval(poll, POLL_INTERVAL_MS);
  interval.unref?.();

  setTimeout(poll, 30_000);

  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Notification polling scheduled");
}
