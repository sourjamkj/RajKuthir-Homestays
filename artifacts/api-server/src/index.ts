import app from "./app";
import { logger } from "./lib/logger";
import { startCalendarCron } from "./lib/calendar-cron";

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
});
