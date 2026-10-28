import { logger } from "./logger";
import { scheduleReviewRequests } from "./review-requests";
import { pollReviews } from "./reviews-service";
import { ensureReviewTables } from "./reviews-migrate";

/**
 * Hourly: queue review asks for stays that just ended (as drafts).
 * Every six hours: fetch new Google reviews and draft replies.
 *
 * Same shape as the other crons: unref'd timers, every error logged and
 * swallowed — a review job must never take the site down.
 */

const HOUR = 60 * 60 * 1000;
let started = false;

export function startReviewsCron(): void {
  if (started) return;
  started = true;

  const requests = () => {
    scheduleReviewRequests()
      .then((outcome) => {
        if (outcome.queued || outcome.skipped.length) logger.info(outcome, "Review requests scheduled");
      })
      .catch((error) => logger.error({ err: error }, "Review request scheduling failed"));
  };

  const reviews = () => {
    pollReviews()
      .then((result) => {
        if (result.added || result.drafted || result.error) logger.info(result, "Google reviews polled");
      })
      .catch((error) => logger.error({ err: error }, "Google review poll failed"));
  };

  void ensureReviewTables();
  setInterval(requests, HOUR).unref?.();
  setInterval(reviews, 6 * HOUR).unref?.();
  setTimeout(requests, 60_000).unref?.();
  setTimeout(reviews, 3 * 60_000).unref?.();
  logger.info("Review requests (hourly) and Google review polling (6-hourly) scheduled");
}
