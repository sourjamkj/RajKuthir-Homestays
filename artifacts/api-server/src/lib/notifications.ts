import { logger } from "./logger";
import type { Booking } from "@workspace/db";
import { buildTemplate, type MessageKind } from "./whatsapp-templates";
import {
  isWhatsappEnabled,
  sendTemplate,
  toWhatsappNumber,
} from "./whatsapp-client";
import {
  bookingsNeedingMessages,
  claimDueMessages,
  hasOptedOutOfMarketing,
  markFailed,
  markSent,
  queueMessage,
} from "./notifications-repo";

/**
 * When each message goes out, and the rules about whether it goes out at all.
 *
 * Two settings shape the behaviour, both off-by-default so that turning this
 * feature on is a deliberate act rather than a side effect of deploying:
 *
 *   WHATSAPP_ENABLED=true            actually talk to the provider
 *   WHATSAPP_REQUIRE_APPROVAL=false  queue as `pending` instead of `draft`
 *
 * With approval required (the default), everything lands as a draft and the
 * owner releases it from the admin console. That is the right default for a
 * one-property business: a scheduling bug costs an apology, not a thousand
 * messages to strangers.
 */

const REQUIRE_APPROVAL = process.env["WHATSAPP_REQUIRE_APPROVAL"] !== "false";
const MAX_ATTEMPTS = 4;
const BATCH_SIZE = 20;

/** Asia/Kolkata is UTC+5:30 and has no DST, so a fixed offset is honest. */
const IST_OFFSET_MIN = 5 * 60 + 30;

/** Nothing reaches a guest's phone between these hours, local time. */
const QUIET_START_HOUR = 21;
const QUIET_END_HOUR = 8;

/** The UTC instant of `hour:00` IST on the given yyyy-mm-dd. */
function istMoment(isoDate: string, hour: number): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(
    Date.UTC(year!, month! - 1, day!, hour, 0) - IST_OFFSET_MIN * 60_000,
  );
}

function istHourOf(at: Date): number {
  return new Date(at.getTime() + IST_OFFSET_MIN * 60_000).getUTCHours();
}

function istDateOf(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MIN * 60_000)
    .toISOString()
    .slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const at = new Date(`${isoDate}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * Pushes a send time out of quiet hours. A confirmation earned at 2am waits
 * until 8am rather than waking someone — it is good news, not urgent news.
 */
function respectQuietHours(at: Date): Date {
  const hour = istHourOf(at);
  if (hour >= QUIET_END_HOUR && hour < QUIET_START_HOUR) return at;

  const dayToUse =
    hour >= QUIET_START_HOUR ? addDays(istDateOf(at), 1) : istDateOf(at);
  return istMoment(dayToUse, QUIET_END_HOUR);
}

/** When each kind should reach the guest, or null if it no longer makes sense. */
function scheduleFor(kind: MessageKind, booking: Booking, now: Date): Date | null {
  switch (kind) {
    case "booking_confirmed":
      // Only worth sending while the stay is still ahead of them.
      return booking.checkIn > istDateOf(now) ? now : null;

    case "checkin_reminder":
      return istMoment(addDays(booking.checkIn, -1), 10);

    case "checkout_today":
      return istMoment(booking.checkOut, 8);

    case "review_request":
      return istMoment(addDays(booking.checkOut, 1), 11);
  }
}

const ALL_KINDS: MessageKind[] = [
  "booking_confirmed",
  "checkin_reminder",
  "checkout_today",
  "review_request",
];

/**
 * Works out which messages a booking still needs and queues them. Safe to
 * call repeatedly — the unique index drops anything already queued.
 */
export async function scheduleForBooking(
  booking: Booking,
  now = new Date(),
): Promise<number> {
  const to = toWhatsappNumber(booking.guestPhone);

  if (!to) {
    // Common for OTA bookings, where the channel masks the guest's number.
    // Not an error, just nothing we can do.
    return 0;
  }

  let queued = 0;

  for (const kind of ALL_KINDS) {
    const at = scheduleFor(kind, booking, now);
    if (!at) continue;

    // Don't queue things whose moment has already passed — a reminder sent
    // after arrival is worse than no reminder.
    if (at.getTime() < now.getTime() - 24 * 60 * 60 * 1000) continue;

    const spec = buildTemplate(kind, booking);

    if (spec.category === "marketing" && (await hasOptedOutOfMarketing(booking.guestPhone))) {
      continue;
    }

    const created = await queueMessage({
      bookingId: booking.id,
      kind,
      toPhone: to,
      templateName: spec.name,
      templateParams: spec.params,
      preview: spec.preview,
      sendAfter: respectQuietHours(at),
      // Marketing always waits for a human, whatever the global setting says.
      status:
        REQUIRE_APPROVAL || spec.category === "marketing" ? "draft" : "pending",
    });

    if (created) queued += 1;
  }

  return queued;
}

/** Sweeps recent and upcoming bookings, queueing anything still missing. */
export async function scheduleUpcoming(now = new Date()): Promise<number> {
  const today = istDateOf(now);
  const rows = await bookingsNeedingMessages(addDays(today, -3), addDays(today, 120));

  let queued = 0;
  for (const booking of rows) {
    try {
      queued += await scheduleForBooking(booking, now);
    } catch (error) {
      logger.error(
        { err: error, bookingId: booking.id },
        "Could not schedule messages for booking",
      );
    }
  }

  return queued;
}

export type DrainResult = { attempted: number; sent: number; failed: number };

/** Sends whatever is due. One message at a time — the volume never justifies more. */
export async function drainOutbox(now = new Date()): Promise<DrainResult> {
  const result: DrainResult = { attempted: 0, sent: 0, failed: 0 };

  if (!isWhatsappEnabled()) return result;
  if (istHourOf(now) >= QUIET_START_HOUR || istHourOf(now) < QUIET_END_HOUR) {
    return result;
  }

  const due = await claimDueMessages(BATCH_SIZE, now);

  for (const message of due) {
    result.attempted += 1;

    const outcome = await sendTemplate({
      to: message.toPhone,
      templateName: message.templateName,
      languageCode: "en",
      params: message.templateParams,
    });

    if (outcome.ok) {
      await markSent(message.id, outcome.providerMessageId);
      result.sent += 1;
      logger.info(
        { messageId: message.id, kind: message.kind },
        "WhatsApp message sent",
      );
    } else {
      await markFailed(
        message.id,
        outcome.error,
        outcome.retryable,
        message.attempts,
        MAX_ATTEMPTS,
      );
      result.failed += 1;
    }
  }

  return result;
}

export async function runNotifications(): Promise<DrainResult> {
  await scheduleUpcoming();
  return drainOutbox();
}
