import { logger } from "./logger";
import { syncCalendarSources } from "./calendar-sync";
import { notifyFreedDates } from "./dates-freed";
import { jobFailed, jobOk, jobStarted } from "./ops-watch";

let started = false;
// Every 15 minutes: a last-minute OTA booking must reach the calendar before
// someone else can book the same night on the website.
const POLL_INTERVAL_MS = 15 * 60 * 1000;

export function startCalendarCron(): void {
  if (started) return;
  started = true;

  const poll = () => {
    syncCalendarSources()
      .then((result) => {
        // Each feed's error is caught inside the sync, so look at the per-feed results.
        const bad = result.sources.filter((s) => s.status === "error");
        if (bad.length) jobFailed("calendar", new Error(bad.map((s) => `${s.label}: ${s.message}`).join("; ")));
        else jobOk("calendar");
      })
      .catch((error) => {
        jobFailed("calendar", error);
        logger.error({ err: error }, "Calendar polling failed unexpectedly");
      })
      // After the sync, so an OTA cancellation just imported counts as free.
      .then(() => notifyFreedDates());
  };

  jobStarted("calendar");
  const interval = setInterval(poll, POLL_INTERVAL_MS);
  interval.unref?.();

  setTimeout(() => {
    poll();
  }, 10_000);

  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Calendar polling scheduled");
}