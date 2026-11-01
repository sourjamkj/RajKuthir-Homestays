import { pool } from "@workspace/db";

import { logger } from "./logger";
import {
  deviceIsUsable,
  hashDeviceToken,
  lastSeenIsStale,
  newDeviceToken,
  type DeviceRow,
} from "./owner-devices-rules";

/**
 * The owner's signed-in phones, and a small audit log of console changes.
 *
 * Both tables are created at boot and on first use (additive, idempotent),
 * like caretaker_alerts: deploying this never needs hand-run SQL, and nothing
 * existing is altered.
 */
export const OWNER_APP_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS owner_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  name text NOT NULL,
  platform text NOT NULL,
  push_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS owner_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  via text NOT NULL,
  device_id uuid,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS owner_audit_at_idx ON owner_audit (at DESC);
`;

/**
 * One migration at a time. Right after a deploy the phone's first few requests
 * arrive together; they all wait on the same promise instead of each running
 * the CREATE statements at once. A failure is not remembered, so the next
 * request tries again.
 */
let migration: Promise<boolean> | null = null;

export function ensureOwnerAppTables(): Promise<boolean> {
  if (!migration) {
    migration = pool.query(OWNER_APP_MIGRATION_SQL).then(
      () => true,
      (error: unknown) => {
        logger.error({ err: error }, "Could not create the owner app tables");
        migration = null;
        return false;
      },
    );
  }
  return migration;
}

/** Thrown when a phone's token could not be checked (database down, say): not the same as a wrong token. */
export class TokenCheckUnavailable extends Error {
  constructor() {
    super("Could not check the phone's sign-in just now.");
    this.name = "TokenCheckUnavailable";
  }
}

type DbRow = {
  id: string;
  name: string;
  platform: string;
  push_token: string | null;
  created_at: Date;
  last_seen_at: Date;
  revoked_at: Date | null;
};

function toDevice(row: DbRow): DeviceRow {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    pushToken: row.push_token,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  };
}

/** A new phone. The token is returned once and never stored in clear. */
export async function createDevice(input: { name: string; platform: string }): Promise<{ device: DeviceRow; token: string }> {
  await ensureOwnerAppTables();
  const token = newDeviceToken();
  const { rows } = await pool.query<DbRow>(
    `INSERT INTO owner_devices (token_hash, name, platform) VALUES ($1, $2, $3)
     RETURNING id, name, platform, push_token, created_at, last_seen_at, revoked_at`,
    [hashDeviceToken(token), input.name, input.platform],
  );
  return { device: toDevice(rows[0]!), token };
}

/** The phone a token belongs to, if it is still allowed in. Touches last_seen_at now and then. */
export async function deviceForToken(token: string, now = new Date()): Promise<DeviceRow | null> {
  if (!(await ensureOwnerAppTables())) throw new TokenCheckUnavailable();
  let rows: DbRow[];
  try {
    ({ rows } = await pool.query<DbRow>(
      `SELECT id, name, platform, push_token, created_at, last_seen_at, revoked_at
         FROM owner_devices WHERE token_hash = $1`,
      [hashDeviceToken(token)],
    ));
  } catch (error) {
    logger.error({ err: error }, "Could not look up an owner app token");
    throw new TokenCheckUnavailable();
  }
  const row = rows[0];
  if (!row) return null;
  const device = toDevice(row);
  if (!deviceIsUsable(device, now)) return null;
  if (lastSeenIsStale(device.lastSeenAt, now)) {
    await pool.query(`UPDATE owner_devices SET last_seen_at = $2 WHERE id = $1`, [device.id, now]).catch(() => undefined);
    device.lastSeenAt = now;
  }
  return device;
}

export async function listDevices(): Promise<DeviceRow[]> {
  await ensureOwnerAppTables();
  const { rows } = await pool.query<DbRow>(
    `SELECT id, name, platform, push_token, created_at, last_seen_at, revoked_at
       FROM owner_devices ORDER BY revoked_at IS NOT NULL, last_seen_at DESC LIMIT 50`,
  );
  return rows.map(toDevice);
}

/**
 * When a phone signs in again (after a reinstall, which wipes its token), the
 * earlier sign-ins from the same phone are signed out, so the list in Settings
 * holds one row per phone and an old token cannot be used.
 */
export async function revokeEarlierSignIns(keep: DeviceRow, now = new Date()): Promise<number> {
  await ensureOwnerAppTables();
  const { rowCount } = await pool.query(
    `UPDATE owner_devices SET revoked_at = $4, push_token = NULL
      WHERE id <> $1 AND name = $2 AND platform = $3 AND revoked_at IS NULL`,
    [keep.id, keep.name, keep.platform, now],
  );
  return rowCount ?? 0;
}

/** Signs a phone out. Its push token goes too, so it stops getting alerts. */
export async function revokeDevice(id: string, now = new Date()): Promise<boolean> {
  await ensureOwnerAppTables();
  const { rowCount } = await pool.query(
    `UPDATE owner_devices SET revoked_at = COALESCE(revoked_at, $2), push_token = NULL WHERE id = $1`,
    [id, now],
  );
  return (rowCount ?? 0) > 0;
}

export async function setPushToken(id: string, pushToken: string | null): Promise<void> {
  await ensureOwnerAppTables();
  // One phone per push token: a reinstall must not leave the old row buzzing too.
  if (pushToken) await pool.query(`UPDATE owner_devices SET push_token = NULL WHERE push_token = $1 AND id <> $2`, [pushToken, id]);
  await pool.query(`UPDATE owner_devices SET push_token = $2 WHERE id = $1 AND revoked_at IS NULL`, [id, pushToken]);
}

/** Push tokens of every signed-in phone, for owner alerts (Phase 3). */
export async function activePushTokens(now = new Date()): Promise<string[]> {
  if (!(await ensureOwnerAppTables())) return [];
  const { rows } = await pool.query<DbRow>(
    `SELECT id, name, platform, push_token, created_at, last_seen_at, revoked_at
       FROM owner_devices WHERE push_token IS NOT NULL AND revoked_at IS NULL`,
  );
  return rows.map(toDevice).filter((d) => deviceIsUsable(d, now)).map((d) => d.pushToken!);
}

export type AuditEntry = { at: string; via: string; action: string; detail: Record<string, unknown> };

/** Who changed what. Never throws: a failed log line must not undo the change it records. */
export async function audit(entry: { via: "web" | "app"; deviceId: string | null; action: string; detail?: Record<string, unknown> }): Promise<void> {
  try {
    await ensureOwnerAppTables();
    await pool.query(`INSERT INTO owner_audit (via, device_id, action, detail) VALUES ($1, $2, $3, $4)`, [
      entry.via,
      entry.deviceId,
      entry.action,
      JSON.stringify(entry.detail ?? {}),
    ]);
  } catch (error) {
    logger.error({ err: error, action: entry.action }, "Could not write the owner audit log");
  }
}

export async function recentAudit(limit = 50): Promise<AuditEntry[]> {
  await ensureOwnerAppTables();
  const { rows } = await pool.query<{ at: Date; via: string; action: string; detail: Record<string, unknown> }>(
    `SELECT at, via, action, detail FROM owner_audit ORDER BY at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ at: r.at.toISOString(), via: r.via, action: r.action, detail: r.detail }));
}

/** Expo says these phones no longer exist: stop sending to them. */
export async function forgetPushTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await pool.query(`UPDATE owner_devices SET push_token = NULL WHERE push_token = ANY($1::text[])`, [tokens]).catch(() => undefined);
}

/** Push tokens of the phones given (for "send a test to this phone"). */
export async function pushTokenOf(deviceId: string): Promise<string | null> {
  await ensureOwnerAppTables();
  const { rows } = await pool.query<{ push_token: string | null }>(
    `SELECT push_token FROM owner_devices WHERE id = $1 AND revoked_at IS NULL`,
    [deviceId],
  );
  return rows[0]?.push_token ?? null;
}
