import { gte } from "drizzle-orm";
import { bookings, db, pool } from "@workspace/db";

import { logger } from "./logger";
import { dueAlerts, istDate, toE164, type AlertBooking } from "./caretaker-rules";

/**
 * Caretaker alerts. Two ways out:
 *
 *  - MANUAL (default, free): caretakerQueue() lists what is due in the
 *    console with a one-tap WhatsApp button; see the bottom of this file.
 *  - AUTOMATIC (optional, paid): sent from the owner's own number through
 *    Blueticks (https://api.blueticks.co) when BLUETICKS_API_KEY is set. The rules are in caretaker-rules.ts.
 *
 * Environment:
 *   BLUETICKS_API_KEY        required; without it this whole feature is idle
 *   CARETAKER_WHATSAPP       default +91 78726 85558 (the number on the site)
 *   OWNER_WHATSAPP_NUMBER    default +91 62903 99165; gets a copy of everything
 *
 * Delivery is recorded per (booking, kind, recipient) in caretaker_alerts, a
 * table this file creates itself (additive, IF NOT EXISTS), so a message is
 * never sent twice and a failed one is retried a few times, then dropped.
 */

const MAX_ATTEMPTS = 5;
const INTERVAL_MS = 5 * 60 * 1000;

const MIGRATION = `
CREATE TABLE IF NOT EXISTS caretaker_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  recipient   text NOT NULL,
  status      text NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS caretaker_alert_uniq ON caretaker_alerts (booking_id, kind, recipient);
`;

let migrated = false;

async function ensureTable(): Promise<void> {
  if (migrated) return;
  await pool.query(MIGRATION);
  migrated = true;
}

export function caretakerRecipients(): string[] {
  const list = [
    toE164(process.env["CARETAKER_WHATSAPP"] ?? "+91 78726 85558"),
    toE164(process.env["OWNER_WHATSAPP_NUMBER"] ?? "+91 62903 99165"),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(list)];
}

export function caretakerAlertsEnabled(): boolean {
  return Boolean(process.env["BLUETICKS_API_KEY"]?.trim());
}

/** One WhatsApp text through Blueticks. Resolves to an error string or null. */
export async function sendWhatsappViaBlueticks(to: string, text: string): Promise<string | null> {
  const key = process.env["BLUETICKS_API_KEY"]?.trim();
  if (!key) return "BLUETICKS_API_KEY is not set";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`https://api.blueticks.co/v1/scheduled-messages/${encodeURIComponent(to)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "text", text }),
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => ({}))) as { success?: boolean; error?: unknown; message?: unknown };
    if (!response.ok || body.success === false) {
      return `Blueticks ${response.status}: ${String(body.message ?? body.error ?? "rejected").slice(0, 200)}`;
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message.slice(0, 200) : "send failed";
  } finally {
    clearTimeout(timer);
  }
}

type AlertRow = { booking_id: string; kind: string; recipient: string; status: string; attempts: number };

let running = false;

export async function runCaretakerAlerts(now = new Date()): Promise<{ sent: number; failed: number }> {
  if (!caretakerAlertsEnabled() || running) return { sent: 0, failed: 0 };
  running = true;
  let sent = 0;
  let failed = 0;

  try {
    await ensureTable();
    const recipients = caretakerRecipients();
    if (recipients.length === 0) return { sent, failed };

    const yesterday = istDate(new Date(now.getTime() - 86_400_000));
    const rows = (await db
      .select({
        id: bookings.id,
        source: bookings.source,
        status: bookings.status,
        guestName: bookings.guestName,
        guestPhone: bookings.guestPhone,
        checkIn: bookings.checkIn,
        checkOut: bookings.checkOut,
        guests: bookings.guests,
        pets: bookings.pets,
        grossPaise: bookings.grossPaise,
        receivedPaise: bookings.receivedPaise,
        createdAt: bookings.createdAt,
      })
      .from(bookings)
      .where(gte(bookings.checkOut, yesterday))) as AlertBooking[];

    const records = (await pool.query<AlertRow>(
      "select booking_id, kind, recipient, status, attempts from caretaker_alerts",
    )).rows;
    const byKey = new Map(records.map((r) => [`${r.booking_id}:${r.kind}:${r.recipient}`, r]));
    // "Done" for the rules = every recipient has it sent or has given up.
    const done = new Set<string>();
    for (const b of rows) {
      for (const kind of ["new_booking", "checkin_eve", "checkout_eve", "cancelled"]) {
        const finished = recipients.every((to) => {
          const r = byKey.get(`${b.id}:${kind}:${to}`);
          return r && (r.status === "sent" || r.attempts >= MAX_ATTEMPTS);
        });
        if (finished) done.add(`${b.id}:${kind}`);
      }
    }

    for (const alert of dueAlerts(rows, done, now)) {
      for (const to of recipients) {
        const record = byKey.get(`${alert.bookingId}:${alert.kind}:${to}`);
        if (record && (record.status === "sent" || record.attempts >= MAX_ATTEMPTS)) continue;

        const error = await sendWhatsappViaBlueticks(to, alert.text);
        await pool.query(
          `insert into caretaker_alerts (booking_id, kind, recipient, status, attempts, last_error, sent_at)
           values ($1, $2, $3, $4, 1, $5, $6)
           on conflict (booking_id, kind, recipient) do update
             set status = excluded.status,
                 attempts = caretaker_alerts.attempts + 1,
                 last_error = excluded.last_error,
                 sent_at = excluded.sent_at`,
          [alert.bookingId, alert.kind, to, error ? "failed" : "sent", error, error ? null : now],
        );
        if (error) {
          failed += 1;
          logger.warn({ bookingId: alert.bookingId, kind: alert.kind, error }, "Caretaker alert failed");
        } else {
          sent += 1;
        }
      }
    }

    if (sent || failed) logger.info({ sent, failed }, "Caretaker alerts run");
    return { sent, failed };
  } catch (error) {
    logger.error({ err: error }, "Caretaker alerts run failed");
    return { sent, failed };
  } finally {
    running = false;
  }
}

let started = false;

export function startCaretakerAlerts(): void {
  if (started) return;
  started = true;
  if (!caretakerAlertsEnabled()) {
    logger.info("Caretaker alerts are in manual mode (console queue); set BLUETICKS_API_KEY to send automatically.");
    return;
  }
  const interval = setInterval(() => void runCaretakerAlerts(), INTERVAL_MS);
  interval.unref?.();
  setTimeout(() => void runCaretakerAlerts(), 90_000).unref?.();
  logger.info({ intervalMs: INTERVAL_MS, recipients: caretakerRecipients().length }, "Caretaker WhatsApp alerts scheduled");
}

/* ------------------------------------------------------------------ *
 * Manual mode — the default while there is no paid WhatsApp sender.
 *
 * The same rules produce a queue in the console. The owner taps "Send on
 * WhatsApp", which opens WhatsApp with the message ready for the caretaker,
 * and the item is marked sent (or skipped). Recorded under the recipient
 * "manual", so the automatic sender above, if it is ever switched on,
 * keeps its own record and the two never confuse each other.
 * ------------------------------------------------------------------ */

const MANUAL = "manual";
export type ManualKind = "new_booking" | "checkin_eve" | "checkout_eve" | "cancelled";
const KINDS: ManualKind[] = ["new_booking", "checkin_eve", "checkout_eve", "cancelled"];

export type CaretakerQueueItem = {
  bookingId: string;
  kind: ManualKind;
  guestName: string | null;
  checkIn: string;
  checkOut: string;
  text: string;
  whatsappUrl: string | null;
};

export async function caretakerQueue(now = new Date()): Promise<CaretakerQueueItem[]> {
  await ensureTable();
  const yesterday = istDate(new Date(now.getTime() - 86_400_000));
  const rows = (await db
    .select({
      id: bookings.id,
      source: bookings.source,
      status: bookings.status,
      guestName: bookings.guestName,
      guestPhone: bookings.guestPhone,
      checkIn: bookings.checkIn,
      checkOut: bookings.checkOut,
      guests: bookings.guests,
      pets: bookings.pets,
      grossPaise: bookings.grossPaise,
      receivedPaise: bookings.receivedPaise,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .where(gte(bookings.checkOut, yesterday))) as AlertBooking[];

  const done = new Set(
    (await pool.query<{ booking_id: string; kind: string }>(
      "select booking_id, kind from caretaker_alerts where recipient = $1",
      [MANUAL],
    )).rows.map((r) => `${r.booking_id}:${r.kind}`),
  );

  const caretaker = caretakerRecipients()[0] ?? null;
  const byId = new Map(rows.map((b) => [b.id, b]));

  return dueAlerts(rows, done, now, { manual: true }).map((alert) => {
    const b = byId.get(alert.bookingId)!;
    return {
      bookingId: alert.bookingId,
      kind: alert.kind,
      guestName: b.guestName,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      text: alert.text,
      whatsappUrl: caretaker
        ? `https://wa.me/${caretaker.replace(/\D/g, "")}?text=${encodeURIComponent(alert.text)}`
        : null,
    };
  });
}

/** Marks a queue item done: sent by the owner, or skipped on purpose. */
export async function markCaretakerItem(
  bookingId: string,
  kind: string,
  outcome: "sent" | "skipped",
  now = new Date(),
): Promise<boolean> {
  if (!(KINDS as string[]).includes(kind)) return false;
  await ensureTable();
  const result = await pool.query(
    `insert into caretaker_alerts (booking_id, kind, recipient, status, attempts, sent_at)
     values ($1, $2, $3, $4, 1, $5)
     on conflict (booking_id, kind, recipient) do update set status = excluded.status, sent_at = excluded.sent_at`,
    [bookingId, kind, MANUAL, outcome, now],
  );
  return (result.rowCount ?? 0) > 0;
}
