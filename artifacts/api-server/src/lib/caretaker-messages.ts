import { pool } from "@workspace/db";

import { logger } from "./logger";
import type { CaretakerFields, CaretakerMessageKind } from "./caretaker-messages-rules";

/**
 * History of messages the owner sent the caretaker from the console or the
 * app. Created at boot and on first use (additive), like owner_devices.
 */
export const CARETAKER_MESSAGES_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS caretaker_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  body text NOT NULL,
  to_phone text NOT NULL,
  via text NOT NULL,
  device_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS caretaker_messages_created_idx ON caretaker_messages (created_at DESC);
`;

let migrated = false;

export async function ensureCaretakerMessagesTable(): Promise<boolean> {
  if (migrated) return true;
  try {
    await pool.query(CARETAKER_MESSAGES_MIGRATION_SQL);
    migrated = true;
    return true;
  } catch (error) {
    logger.error({ err: error }, "Could not create caretaker_messages");
    return false;
  }
}

export type CaretakerMessageRow = {
  id: string;
  kind: CaretakerMessageKind;
  fields: CaretakerFields;
  body: string;
  toPhone: string;
  via: string;
  createdAt: string;
  sentAt: string | null;
};

type DbRow = {
  id: string;
  kind: CaretakerMessageKind;
  fields: CaretakerFields;
  body: string;
  to_phone: string;
  via: string;
  created_at: Date;
  sent_at: Date | null;
};

const toRow = (r: DbRow): CaretakerMessageRow => ({
  id: r.id,
  kind: r.kind,
  fields: r.fields,
  body: r.body,
  toPhone: r.to_phone,
  via: r.via,
  createdAt: r.created_at.toISOString(),
  sentAt: r.sent_at ? r.sent_at.toISOString() : null,
});

const COLUMNS = "id, kind, fields, body, to_phone, via, created_at, sent_at";

export async function recordCaretakerMessage(input: {
  kind: CaretakerMessageKind;
  fields: CaretakerFields;
  body: string;
  toPhone: string;
  via: "web" | "app";
  deviceId: string | null;
}): Promise<CaretakerMessageRow> {
  await ensureCaretakerMessagesTable();
  const { rows } = await pool.query<DbRow>(
    `INSERT INTO caretaker_messages (kind, fields, body, to_phone, via, device_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
    [input.kind, JSON.stringify(input.fields), input.body, input.toPhone, input.via, input.deviceId],
  );
  return toRow(rows[0]!);
}

export async function markCaretakerMessageSent(id: string): Promise<CaretakerMessageRow | null> {
  await ensureCaretakerMessagesTable();
  const { rows } = await pool.query<DbRow>(
    `UPDATE caretaker_messages SET sent_at = COALESCE(sent_at, now()) WHERE id = $1 RETURNING ${COLUMNS}`,
    [id],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

export async function recentCaretakerMessages(limit = 30): Promise<CaretakerMessageRow[]> {
  await ensureCaretakerMessagesTable();
  const { rows } = await pool.query<DbRow>(`SELECT ${COLUMNS} FROM caretaker_messages ORDER BY created_at DESC LIMIT $1`, [limit]);
  return rows.map(toRow);
}
