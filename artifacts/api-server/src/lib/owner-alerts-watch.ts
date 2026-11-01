import { pool } from "@workspace/db";

import { listActivity } from "./activity-repo";
import { logger } from "./logger";
import { notifyOwner } from "./owner-alerts";
import { checkinTomorrowAlert, eventForActivity, isEveningRun, istTomorrow } from "./owner-alert-rules";

/**
 * Alerts for things that are not one request's doing: OTA bookings and
 * cancellations arriving by mail or calendar sync, enquiries, ID uploads,
 * WhatsApp messages waiting or failed, and the evening "check-in tomorrow".
 *
 * Every two minutes. Keeps its own cursor in app_settings, so pushing never
 * marks the console's bell as read. The first run only sets the cursor: a new
 * install is not flooded with a month of history.
 */
const CURSOR_KEY = "owner.alerts.cursor";
const EVERY_MS = 2 * 60_000;

async function readCursor(): Promise<Date | null> {
  const { rows } = await pool.query<{ value: string | null }>(`SELECT value FROM app_settings WHERE key = $1`, [CURSOR_KEY]);
  const value = rows[0]?.value;
  return value ? new Date(value) : null;
}

async function writeCursor(at: Date): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [CURSOR_KEY, at.toISOString()],
  );
}

export async function runOwnerAlertWatch(now = new Date()): Promise<void> {
  const cursor = await readCursor();
  if (!cursor) {
    await writeCursor(now);
    return;
  }

  // 1. Activity since the cursor.
  const { items } = await listActivity(now, cursor);
  for (const item of items) {
    const event = eventForActivity(item);
    if (!event) continue;
    await notifyOwner({ event, title: item.title, body: item.detail, href: item.href, dedupeKey: `activity:${item.id}` }, now);
  }

  // 2. WhatsApp messages that failed since the cursor.
  const failed = await pool
    .query<{ id: string; kind: string; to_phone: string; error: string | null }>(
      `SELECT id, kind::text, to_phone, error FROM whatsapp_messages WHERE status = 'failed' AND updated_at > $1 ORDER BY updated_at LIMIT 20`,
      [cursor],
    )
    .catch(() => ({ rows: [] as Array<{ id: string; kind: string; to_phone: string; error: string | null }> }));
  for (const m of failed.rows) {
    await notifyOwner(
      {
        event: "message_failed",
        title: "WhatsApp message not delivered",
        body: `${m.kind.replace(/_/g, " ")} to +${m.to_phone}${m.error ? `: ${m.error.slice(0, 120)}` : ""}`,
        href: "/admin/guests#messages",
        dedupeKey: `failed:${m.id}`,
      },
      now,
    );
  }

  // 3. Messages waiting for the owner: once a day, while there are any.
  const waiting = await pool
    .query<{ n: string }>(`SELECT count(*)::text AS n FROM whatsapp_messages WHERE status = 'draft'`)
    .catch(() => ({ rows: [{ n: "0" }] }));
  const count = Number(waiting.rows[0]?.n ?? 0);
  if (count > 0) {
    const day = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    await notifyOwner(
      {
        event: "message_draft",
        title: `${count} WhatsApp message${count === 1 ? "" : "s"} to send`,
        body: "Guest messages are waiting for you to approve, or to send from your own WhatsApp.",
        href: "/admin/guests#messages",
        dedupeKey: `drafts:${day}`,
      },
      now,
    );
  }

  // 4. From 6 pm: who arrives tomorrow.
  if (isEveningRun(now)) {
    const tomorrow = istTomorrow(now);
    const arrivals = await pool.query<{ id: string; guest_name: string | null; source: string; check_in: string; check_out: string; guests: number | null }>(
      `SELECT id, guest_name, source::text, check_in::text, check_out::text, guests FROM bookings WHERE status = 'confirmed' AND check_in = $1`,
      [tomorrow],
    );
    for (const b of arrivals.rows) {
      const text = checkinTomorrowAlert({ guestName: b.guest_name, source: b.source, checkIn: b.check_in, checkOut: b.check_out, guests: b.guests });
      await notifyOwner({ event: "checkin_tomorrow", ...text, href: `/admin/guests#stay-${b.id}`, dedupeKey: `checkin:${b.id}:${b.check_in}` }, now);
    }
  }

  await writeCursor(now);
}

let started = false;
let running = false;

export function startOwnerAlertWatch(): void {
  if (started) return;
  started = true;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runOwnerAlertWatch();
    } catch (error) {
      logger.error({ err: error }, "Owner alert watch failed");
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), 45_000).unref?.();
  setInterval(() => void tick(), EVERY_MS).unref?.();
}
