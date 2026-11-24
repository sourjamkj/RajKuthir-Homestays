import { logger } from "./logger";
import type { Booking } from "@workspace/db";
import { buildTemplate, checkoutTemplateName, type MessageKind } from "./whatsapp-templates";
import { withHouseRules } from "./house-rules";
import { sendConfirmationOnWhatsapp } from "./invoices";
import { REVIEW_TEMPLATE_NAMES } from "./review-rules";
import { nextRepeat } from "./notifications-repeat";
import { readFile } from "node:fs/promises";
import {
  sendTemplate,
  toWhatsappNumber,
  uploadMedia,
  type SendResult,
} from "./whatsapp-client";
import { findPackPdf } from "./arrival-pack";
import { reviewStillSendable, reviewTemplateForSend } from "./review-requests";
import {
  bookingsNeedingMessages,
  claimDueMessages,
  hasOptedOutOfMarketing,
  markFailed,
  markSent,
  queueMessage,
  requeueMessage,
  setMessageStatus,
} from "./notifications-repo";
import { createOrRefreshOnboarding } from "./guest-onboarding-repo";
import { guestApiSendingOn } from "./whatsapp-mode";
import { pool } from "@workspace/db";
import { autoSendKinds } from "./owner-settings-state";
import { notifyOwner } from "./owner-alerts";
import { ensureReviewTables } from "./reviews-migrate";

/**
 * When each message goes out, and the rules about whether it goes out at all.
 *
 * Two settings shape the behaviour, both off by default so that turning this
 * feature on is a deliberate act rather than a side effect of deploying:
 *
 *   WHATSAPP_ENABLED=true   actually talk to the provider (Railway)
 *   Auto-send (console)     which booking messages queue as `pending` instead
 *                           of `draft`; see AUTO_SEND_KINDS. Unset follows the
 *                           old WHATSAPP_REQUIRE_APPROVAL switch.
 *
 * Anything not auto-sent lands as a draft and the owner releases it. That is
 * the right default for a one-property business: a scheduling bug costs an
 * apology, not a thousand messages to strangers.
 */

const MAX_ATTEMPTS = 4;
const BATCH_SIZE = 20;

/** Asia/Kolkata is UTC+5:30 and has no DST, so a fixed offset is honest. */
const IST_OFFSET_MIN = 5 * 60 + 30;

/** Nothing reaches a guest's phone between these hours, local time. */
const QUIET_START_HOUR = 23;
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
      // The confirmation PDF with the house rules. Held until the guests' ID
      // is verified (claimDueMessages), so "now" means "as soon as verified".
      return booking.checkOut >= istDateOf(now) ? now : null;

    case "checkin_reminder":
      return istMoment(addDays(booking.checkIn, -1), 10);

    case "checkin_welcome":
      // Check-in time, so the Wi-Fi poster is at hand when they walk in.
      return istMoment(booking.checkIn, 12);

    case "checkout_today":
      // An hour before the 11 am check-out: time to call the caretaker for the deposit check.
      return istMoment(booking.checkOut, 10);

    case "verification_reminder": {
      // Every 24 hours (nextSendOf) while the ID is unverified. A website
      // booking's payment message already carried the upload link, so its
      // first reminder is a day later; a channel booking's goes now.
      if (booking.checkIn < istDateOf(now)) return null;
      const dayAfterBooking = new Date(booking.createdAt.getTime() + 24 * 60 * 60 * 1000);
      return booking.source === "direct" && dayAfterBooking > now ? dayAfterBooking : now;
    }

    case "owner_new_booking":
      return null; // routed to the owner-only Telegram alert outbox

    case "review_request":
      // Queued by review-requests.ts instead: it has its own timing (14:00
      // IST on check-out day, 3-day cut-off) and eligibility rules.
      return null;
  }
}

/** review_request is scheduled by review-requests.ts, not here. */
const ALL_KINDS: MessageKind[] = [
  "booking_confirmed",
  "checkin_reminder",
  "checkin_welcome",
  "checkout_today",
  "verification_reminder",
];

/**
 * Works out which messages a booking still needs and queues them. Safe to
 * call repeatedly — the unique index drops anything already queued.
 */
export async function scheduleForBooking(
  booking: Booking,
  now = new Date(),
): Promise<number> {
  let queued = (await queueOwnerAlert(booking, now)) ? 1 : 0;
  const to = toWhatsappNumber(booking.guestPhone);

  if (!to) {
    // Common for OTA bookings, where the channel masks the guest's number.
    // Not an error, just nothing we can do.
    return queued;
  }

  // A verified guest never gets an ID reminder; the next steps follow on their own.
  const verified = (
    await pool.query("SELECT 1 FROM guest_onboarding WHERE booking_id = $1 AND status = 'verified'", [booking.id])
  ).rowCount;

  for (const kind of ALL_KINDS) {
    if (kind === "verification_reminder" && verified) continue;
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
      // Marketing always waits for a human, whatever the owner allowed.
      status: spec.category !== "marketing" && autoSendKinds().includes(kind) ? "pending" : "draft",
    });

    if (created) queued += 1;
  }

  return queued;
}

/**
 * Messages queued as drafts while a kind was not ticked for auto-send (or
 * WhatsApp was in manual mode) stay drafts forever, because each booking
 * gets one message per kind. Once the owner ticks a kind, still-useful
 * drafts of it go out too: anything whose moment is still ahead, and the
 * confirmation PDF and arrival messages while they are still useful (see
 * expireArrivalMessages), since they wait on ID checks.
 */
async function promoteDrafts(now = new Date()): Promise<void> {
  const kinds = autoSendKinds().filter((k) => (ALL_KINDS as readonly string[]).includes(k));
  if (!kinds.length) return;
  const { rowCount } = await pool.query(
    `UPDATE whatsapp_messages m SET status = 'pending', updated_at = now()
     FROM bookings b
     WHERE m.booking_id = b.id AND m.status = 'draft' AND m.kind::text = ANY($1)
       AND b.status = 'confirmed' AND b.check_out >= ($2::timestamptz AT TIME ZONE 'Asia/Kolkata')::date
       AND (m.send_after > $2::timestamptz - interval '1 hour' OR m.kind IN ('booking_confirmed', 'checkin_reminder', 'checkin_welcome', 'verification_reminder'))`,
    [kinds, now],
  );
  if (rowCount) logger.info({ promoted: rowCount }, "Auto-send now covers queued drafts");
}

/**
 * Arrival messages held back for ID verification go out once it is done,
 * but not after they stop making sense: the arrival reminder by noon on
 * check-in day, the check-in welcome by 11 am check-out.
 */
async function expireArrivalMessages(now = new Date()): Promise<void> {
  await pool.query(
    `UPDATE whatsapp_messages m SET status = 'cancelled', error = 'Not sent: the moment had passed', updated_at = now()
     FROM bookings b
     WHERE m.booking_id = b.id AND m.status = 'pending'
       AND ((m.kind = 'checkin_reminder' AND $1::timestamptz > (b.check_in + time '12:00') AT TIME ZONE 'Asia/Kolkata')
         OR (m.kind IN ('booking_confirmed', 'checkin_welcome') AND $1::timestamptz > (b.check_out + time '11:00') AT TIME ZONE 'Asia/Kolkata'))`,
    [now],
  );
  // ID reminders that no longer have a job: the ID is verified, or check-in day has come.
  await pool.query(
    `UPDATE whatsapp_messages m SET status = 'cancelled', error = 'Not needed: ID verified or check-in reached', updated_at = now()
     FROM bookings b
     WHERE m.booking_id = b.id AND m.kind = 'verification_reminder' AND m.status IN ('draft', 'pending')
       AND (b.check_in <= ($1::timestamptz AT TIME ZONE 'Asia/Kolkata')::date
         OR EXISTS (SELECT 1 FROM guest_onboarding o WHERE o.booking_id = b.id AND o.status = 'verified'))`,
    [now],
  );
}

/**
 * A fresh pre-arrival link token while the booking's guests are not yet
 * verified; null once they are (or for a booking that no longer exists).
 * Issuing a new link replaces any older one, as the console does.
 */
async function issueIdLinkIfUnverified(bookingId: string): Promise<string | null> {
  const { rows } = await pool.query<{ status: string }>(
    "SELECT status FROM guest_onboarding WHERE booking_id = $1",
    [bookingId],
  );
  if (rows[0]?.status === "verified") return null;
  return (await createOrRefreshOnboarding(bookingId))?.token ?? null;
}

/**
 * Owner-only alert for a direct website booking. OTA imports are already
 * notified by the activity watcher; avoid sending a second Telegram alert.
 */
async function queueOwnerAlert(booking: Booking, now: Date): Promise<boolean> {
  if (booking.source !== "direct") return false;
  if (booking.createdAt.getTime() < now.getTime() - 24 * 60 * 60 * 1000) return false;
  await notifyOwner({
    event: "booking_confirmed",
    title: `New booking confirmed: ${booking.guestName ?? "Guest"}`,
    body: `${booking.checkIn} → ${booking.checkOut} · ${booking.source} · ref ${booking.reference ?? "pending"}`,
    href: `/admin/guests#stay-${booking.id}`,
    dedupeKey: `booking-confirmed:${booking.id}`,
  }, now);
  return true;
}

/**
 * When a message that repeats goes out again, or null when it is done.
 *  - ID reminder: every 24 hours, the last one on the day before check-in.
 *    (Verification stops it sooner: the send is cancelled once verified.)
 *  - Review request: one reminder at 6 pm the day after check-out, only
 *    after the first ask on check-out day.
 */
async function nextSendOf(message: { kind: string; bookingId: string | null }, now: Date): Promise<Date | null> {
  if (!message.bookingId || (message.kind !== "verification_reminder" && message.kind !== "review_request")) return null;
  const { rows } = await pool.query<{ check_in: string; check_out: string }>(
    "SELECT check_in::text, check_out::text FROM bookings WHERE id = $1",
    [message.bookingId],
  );
  return rows[0] ? nextRepeat(message.kind, rows[0].check_in, rows[0].check_out, now) : null;
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

  // Manual mode: drafts wait for the owner to send them from their own WhatsApp.
  if (!guestApiSendingOn()) return result;
  // Retire legacy owner_new_booking WhatsApp rows. Owner operations now use
  // the owner-only Telegram alert outbox, never the guest/caretaker sender.
  await pool.query(
    `UPDATE whatsapp_messages
       SET status = 'cancelled', error = 'Owner alerts now route through Telegram', updated_at = now()
     WHERE kind = 'owner_new_booking' AND status IN ('draft', 'pending')`,
  );

  // Quiet hours hold every guest message.
  const quiet = istHourOf(now) >= QUIET_START_HOUR || istHourOf(now) < QUIET_END_HOUR;

  const due = await claimDueMessages(BATCH_SIZE, now, quiet ? ["owner_new_booking"] : undefined);

  for (const message of due) {
    // A review ask may have been approved days after it was queued, or the
    // stay cancelled or flagged since. Re-check before it goes.
    if (message.kind === "review_request") {
      const check = await reviewStillSendable(message, now);
      if (!check.ok) {
        await markFailed(message.id, `Not sent: ${check.reason}`, false, message.attempts, MAX_ATTEMPTS);
        continue;
      }
    }

    // Sent only while the ID is still unverified, with a freshly issued link.
    let idLinkToken: string | undefined;
    if (message.kind === "verification_reminder") {
      const issued = message.bookingId ? await issueIdLinkIfUnverified(message.bookingId) : null;
      if (!issued) {
        await setMessageStatus(message.id, "cancelled");
        continue;
      }
      idLinkToken = issued;
    }

    result.attempted += 1;

    const outcome =
      message.kind === "checkin_welcome"
        ? await sendWithPoster(message.toPhone, message.templateName, message.templateParams)
        : message.kind === "booking_confirmed" && message.bookingId
          ? await sendConfirmationOnWhatsapp(message.bookingId, message.toPhone, now)
          : await sendTemplate({
        to: message.toPhone,
        templateName:
          message.kind === "review_request"
            ? reviewTemplateForSend(message.templateName)
            : message.kind === "checkout_today"
              ? checkoutTemplateName()
              : message.templateName,
        languageCode: "en",
        params: message.templateParams,
        urlButtonParam: idLinkToken,
      });

    if (outcome.ok) {
      await markSent(message.id, outcome.providerMessageId);
      const next = await nextSendOf(message, now);
      // The review reminder is the short variant; never to a guest who has opted out.
      if (next && !(message.kind === "review_request" && (await hasOptedOutOfMarketing(message.toPhone)))) {
        await requeueMessage(message.id, next, message.kind === "review_request" ? REVIEW_TEMPLATE_NAMES.short : undefined);
      }
      result.sent += 1;
      logger.info(
        { messageId: message.id, kind: message.kind },
        "WhatsApp message sent",
      );
    } else {
      // No automatic retries: the owner is alerted (owner-alerts-watch) and retries after fixing.
      await markFailed(message.id, outcome.error, false, message.attempts, MAX_ATTEMPTS);
      result.failed += 1;
    }
  }

  return result;
}

/**
 * The check-in welcome, with the Wi-Fi poster (assets/arrival-pack.pdf: Wi-Fi
 * QR and contact numbers) as the template's Document header. Without the file
 * the send is refused rather than sent bare: the approved template needs it.
 */
async function sendWithPoster(to: string, templateName: string, params: string[]): Promise<SendResult> {
  const file = findPackPdf();
  if (!file) return { ok: false, error: "The Wi-Fi poster PDF (assets/arrival-pack.pdf) is missing.", retryable: false };

  const filename = "raj-kuthir-wifi-and-contacts.pdf";
  // The house rules ride along as the last pages, so they are at hand on arrival too.
  const media = await uploadMedia({ bytes: await withHouseRules(await readFile(file)), mimeType: "application/pdf", filename });
  if (!media.ok) return { ok: false, error: `Poster upload refused: ${media.error}`, retryable: true };

  return sendTemplate({ to, templateName, params, headerDocument: { mediaId: media.mediaId, filename } });
}

let inFlight: Promise<DrainResult> | null = null;
let again = false;

/**
 * One run at a time: the cron, an Approve tap and an ID verification can all
 * ask at once, and two overlapping drains would send a message twice. A
 * request made during a run gets one more run straight after.
 * shortcut: in-process lock, fine for one Railway replica; use a DB lock if it ever scales out.
 */
export function runNotifications(): Promise<DrainResult> {
  if (inFlight) {
    again = true;
    return inFlight;
  }
  inFlight = (async () => {
    try {
      let result: DrainResult;
      do {
        again = false;
        result = await runOnce();
      } while (again);
      return result;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function runOnce(): Promise<DrainResult> {
  // The outbox table and any message kinds added since it was created.
  await ensureReviewTables();
  await scheduleUpcoming();
  await promoteDrafts();
  await expireArrivalMessages();
  return drainOutbox();
}
