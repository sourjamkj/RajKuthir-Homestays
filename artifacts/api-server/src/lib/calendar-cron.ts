import { logger } from "./logger";
import { syncCalendarSources } from "./calendar-sync";

let started = false;
// Every 15 minutes: a last-minute OTA booking must reach the calendar before
// someone else can book the same night on the website.
const POLL_INTERVAL_MS = 15 * 60 * 1000;

export function startCalendarCron(): void {
  if (started) return;
  started = true;

  const poll = () => {
    syncCalendarSources().catch((error) => {
      logger.error({ err: error }, "Calendar polling failed unexpectedly");
    });
  };

  const interval = setInterval(poll, POLL_INTERVAL_MS);
  interval.unref?.();

  setTimeout(() => {
    poll();
  }, 10_000);

  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Calendar polling scheduled");
}