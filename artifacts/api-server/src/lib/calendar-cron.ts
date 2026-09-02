import { logger } from "./logger";
import { syncCalendarSources } from "./calendar-sync";

let started = false;
const POLL_INTERVAL_MS = 2 * 60 * 60 * 1000;

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