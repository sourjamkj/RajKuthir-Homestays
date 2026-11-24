import { pool } from "@workspace/db";

import { ownerEmail, sendEmail } from "./book-pay-notify";
import { pushToPhones } from "./expo-push";
import { logger } from "./logger";
import { activePushTokens, forgetPushTokens } from "./owner-devices";
import type { OwnerEvent } from "./owner-settings-rules";
import { emailEnabledFor, pushEnabledFor, quietHoursNow } from "./owner-settings-state";
import { ownerTelegramTarget, sendOwnerTelegramMessage } from "./telegram-owner";

/**
 * Everything the owner is told about, in one place: a row in the app's alert
 * list, a push to every signed-in phone, and (for the events that have always
 * been emailed) the email. Settings decide push and email per event; the
 * alert list keeps everything.
 *
 * owner_alerts is created at boot and on first use (additive). dedupe_key
 * makes an alert idempotent: the same booking cannot buzz the phone twice.
 */
export const OWNER_ALERTS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS owner_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  href text NOT NULL DEFAULT '/admin',
  dedupe_key text UNIQUE,
  pushed_to integer NOT NULL DEFAULT 0,
  emailed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  telegram_sent boolean NOT NULL DEFAULT false,
  telegram_attempts integer NOT NULL DEFAULT 0,
  telegram_last_attempt_at timestamptz,
  telegram_last_error text
);
ALTER TABLE owner_alerts ADD COLUMN IF NOT EXISTS telegram_sent boolean NOT NULL DEFAULT false;
ALTER TABLE owner_alerts ADD COLUMN IF NOT EXISTS telegram_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE owner_alerts ADD COLUMN IF NOT EXISTS telegram_last_attempt_at timestamptz;
ALTER TABLE owner_alerts ADD COLUMN IF NOT EXISTS telegram_last_error text;
CREATE INDEX IF NOT EXISTS owner_alerts_created_idx ON owner_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS owner_alerts_telegram_pending_idx
  ON owner_alerts (created_at) WHERE telegram_sent = false AND telegram_attempts < 10;
`;

let migrated = false;

export async function ensureOwnerAlertsTable(): Promise<boolean> {
  if (migrated) return true;
  try {
    await pool.query(OWNER_ALERTS_MIGRATION_SQL);
    migrated = true;
    return true;
  } catch (error) {
    logger.error({ err: error }, "Could not create owner_alerts");
    return false;
  }
}


/**
 * Claim then send one persisted alert. If the Telegram request fails, the
 * row remains pending and the two-minute watcher will retry it. Claiming is
 * atomic so notifyOwner and the watcher cannot send the same alert twice.
 */
async function deliverOwnerTelegramAlert(id: string): Promise<boolean> {
  if (!ownerTelegramTarget()) return false;
  const { rows } = await pool.query<{ title: string; body: string; href: string; attempts: number }>(
    `UPDATE owner_alerts
        SET telegram_attempts = telegram_attempts + 1,
            telegram_last_attempt_at = now()
      WHERE id = $1
        AND telegram_sent = false
        AND telegram_attempts < 10
        AND (telegram_last_attempt_at IS NULL OR telegram_last_attempt_at < now() - interval '2 minutes')
      RETURNING title, body, href, telegram_attempts AS attempts`,
    [id],
  );
  const row = rows[0];
  if (!row) return false;

  const href = /^\/[A-Za-z0-9/?#=&._%-]*$/.test(row.href)
    ? `https://rajkuthirhomestays.casa${row.href}`
    : null;
  const message = [
    `🏡 Raj Kuthir · ${row.title}`,
    row.body,
    ...(href ? [`Open: ${href}`] : []),
  ].filter(Boolean).join("\n").slice(0, 4000);
  const sent = await sendOwnerTelegramMessage(message);
  if (!sent.configured) return false;

  await pool.query(
    `UPDATE owner_alerts
        SET telegram_sent = $2,
            telegram_last_error = $3
      WHERE id = $1`,
    [id, sent.ok, sent.ok ? null : sent.reason],
  );
  return sent.ok;
}

/** Retry unsent owner alerts after a transient Telegram/API outage. */
export async function flushPendingOwnerTelegramAlerts(limit = 20): Promise<{ attempted: number; sent: number }> {
  if (!ownerTelegramTarget()) return { attempted: 0, sent: 0 };
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM owner_alerts
      WHERE telegram_sent = false
        AND telegram_attempts < 10
        AND (telegram_last_attempt_at IS NULL OR telegram_last_attempt_at < now() - interval '2 minutes')
      ORDER BY created_at ASC
      LIMIT $1`,
    [safeLimit],
  );
  let sent = 0;
  for (const row of rows) {
    if (await deliverOwnerTelegramAlert(row.id).catch((error) => {
      logger.warn({ err: error instanceof Error ? error.message : "unknown" }, "Owner Telegram delivery failed");
      return false;
    })) sent += 1;
  }
  return { attempted: rows.length, sent };
}

export type OwnerAlertInput = {
  event: OwnerEvent;
  title: string;
  body: string;
  /** Console path the alert opens, e.g. /admin/guests#payments. */
  href?: string;
  dedupeKey?: string;
  /** The email that has always gone for this event (with its attachment). Sent if email is on for it. */
  email?: { subject: string; text: string; attachments?: Array<{ filename: string; content: Uint8Array; contentType: string }> };
};

/** Never throws: telling the owner must never break whatever happened. */
export async function notifyOwner(input: OwnerAlertInput, now = new Date()): Promise<{ id: string | null; pushed: number; emailed: boolean }> {
  let id: string | null = null;
  try {
    if (await ensureOwnerAlertsTable()) {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO owner_alerts (event, title, body, href, dedupe_key) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
        [input.event, input.title, input.body, input.href ?? "/admin", input.dedupeKey ?? null],
      );
      if (!rows[0]) return { id: null, pushed: 0, emailed: false }; // already recorded
      id = rows[0].id;
    }
  } catch (error) {
    logger.error({ err: error, event: input.event }, "Could not record an owner alert");
  }

  if (id) {
    await deliverOwnerTelegramAlert(id).catch((error) => {
      logger.warn({ err: error instanceof Error ? error.message : "unknown" }, "Owner Telegram delivery failed");
    });
  }

  let pushed = 0;
  if (pushEnabledFor(input.event)) {
    try {
      const result = await pushToPhones(
        await activePushTokens(now),
        { title: input.title, body: input.body, data: { alertId: id ?? "", event: input.event, href: input.href ?? "/admin" } },
        quietHoursNow(now),
      );
      pushed = result.sent;
      await forgetPushTokens(result.dead);
    } catch (error) {
      logger.warn({ err: error instanceof Error ? error.message : error }, "Owner push failed");
    }
  }

  let emailed = false;
  if (input.email && emailEnabledFor(input.event)) {
    emailed = await sendEmail(await ownerEmail(), input.email.subject, input.email.text, input.email.attachments).catch(() => false);
  }

  if (id) await pool.query(`UPDATE owner_alerts SET pushed_to = $2, emailed = $3 WHERE id = $1`, [id, pushed, emailed]).catch(() => undefined);
  return { id, pushed, emailed };
}

export type OwnerAlert = {
  id: string;
  event: string;
  title: string;
  body: string;
  href: string;
  createdAt: string;
  read: boolean;
  pushed: boolean;
  emailed: boolean;
};

export async function listOwnerAlerts(limit = 50): Promise<{ alerts: OwnerAlert[]; unread: number }> {
  await ensureOwnerAlertsTable();
  const [{ rows }, unread] = await Promise.all([
    pool.query<{ id: string; event: string; title: string; body: string; href: string; created_at: Date; read_at: Date | null; pushed_to: number; emailed: boolean }>(
      `SELECT id, event, title, body, href, created_at, read_at, pushed_to, emailed FROM owner_alerts ORDER BY created_at DESC LIMIT $1`,
      [limit],
    ),
    pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM owner_alerts WHERE read_at IS NULL`),
  ]);
  return {
    alerts: rows.map((r) => ({
      id: r.id,
      event: r.event,
      title: r.title,
      body: r.body,
      href: r.href,
      createdAt: r.created_at.toISOString(),
      read: Boolean(r.read_at),
      pushed: r.pushed_to > 0,
      emailed: r.emailed,
    })),
    unread: Number(unread.rows[0]?.n ?? 0),
  };
}

/** Marks some alerts read, or all of them when ids is omitted. */
export async function markOwnerAlertsRead(ids?: string[]): Promise<void> {
  await ensureOwnerAlertsTable();
  if (ids && ids.length) await pool.query(`UPDATE owner_alerts SET read_at = COALESCE(read_at, now()) WHERE id = ANY($1::uuid[])`, [ids]);
  else await pool.query(`UPDATE owner_alerts SET read_at = now() WHERE read_at IS NULL`);
}
