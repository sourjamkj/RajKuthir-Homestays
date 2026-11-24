/**
 * WhatsApp Cloud API webhook: verification, signature check, inbound message
 * storage, status callbacks.
 *
 * This file receives the raw POST from Meta and does three things:
 *   1. Verifies the X-Hub-Signature-256 HMAC over the raw body.
 *   2. Stores every inbound message with deduplication (wa_id unique).
 *   3. Updates delivery statuses (sent → delivered → read → failed).
 *
 * Nothing here decides what to *reply* — that is wa-bot.ts. This file is
 * the plumbing: accept, validate, store, acknowledge.
 *
 * Environment:
 *   WHATSAPP_VERIFY_TOKEN     a secret string you pick; Meta sends it back
 *                             in the GET verification request
 *   WHATSAPP_APP_SECRET       the App Secret from Meta's App Dashboard,
 *                             used to verify the X-Hub-Signature-256 HMAC
 *   WHATSAPP_AUTOREPLY_ENABLED  "true" to let the bot reply; default false
 *   WHATSAPP_TEST_NUMBERS     comma-separated E.164 numbers (no +) that
 *                             bypass the AUTOREPLY_ENABLED gate, for testing
 */

import { pool } from "@workspace/db";

// Pure functions live in wa-webhook-rules.ts so tests can run without
// @workspace/db. Re-exported here for call-site convenience.
export {
  isAutoReplyEnabled,
  testNumbers,
  shouldAutoReply,
  verifySignature,
  isWithin24h,
  parseWebhookPayload,
  type InboundMessage,
  type ParsedInbound,
} from "./wa-webhook-rules";

import type { InboundMessage as _InboundMessage } from "./wa-webhook-rules";

/* ------------------------------------------------------------------ *
 * Database: wa_inbound_messages + wa_conversations
 * ------------------------------------------------------------------ */

const MIGRATION = `
CREATE TABLE IF NOT EXISTS wa_inbound_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_id         text UNIQUE NOT NULL,
  phone         text NOT NULL,
  direction     text NOT NULL DEFAULT 'inbound',
  msg_type      text NOT NULL DEFAULT 'text',
  body_text     text,
  payload       jsonb,
  status        text,
  status_at     timestamptz,
  error_code    text,
  error_title   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_inbound_phone_idx ON wa_inbound_messages (phone, created_at DESC);

CREATE TABLE IF NOT EXISTS wa_conversations (
  phone         text PRIMARY KEY,
  state         text NOT NULL DEFAULT 'bot',
  last_inbound_at timestamptz,
  assigned_booking_id uuid,
  muted_until   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
`;

let migrated = false;

export async function ensureWaInboundTables(): Promise<void> {
  if (migrated) return;
  await pool.query(MIGRATION);
  migrated = true;
}

/* ------------------------------------------------------------------ *
 * Store inbound messages (with deduplication)
 * ------------------------------------------------------------------ */

/**
 * Stores an inbound message and creates/updates its conversation atomically.
 * Returns false only for a genuine duplicate provider message ID. Database
 * errors deliberately propagate so the webhook can return 5xx and Meta retries.
 */
export async function storeInbound(msg: _InboundMessage): Promise<boolean> {
  await ensureWaInboundTables();
  const result = await pool.query(
    `WITH inserted AS (
       INSERT INTO wa_inbound_messages (wa_id, phone, direction, msg_type, body_text, payload, created_at)
       VALUES ($1, $2, 'inbound', $3, $4, $5, to_timestamp($6))
       ON CONFLICT (wa_id) DO NOTHING
       RETURNING phone, created_at
     ),
     conversation AS (
       INSERT INTO wa_conversations (phone, last_inbound_at)
       SELECT phone, created_at FROM inserted
       ON CONFLICT (phone) DO UPDATE
         SET last_inbound_at = GREATEST(
           COALESCE(wa_conversations.last_inbound_at, EXCLUDED.last_inbound_at),
           EXCLUDED.last_inbound_at
         ),
         updated_at = now()
       RETURNING phone
     )
     SELECT phone FROM inserted`,
    [msg.waId, msg.phone, msg.type, msg.text, JSON.stringify(msg.payload), msg.timestamp],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Stores an outbound message we sent, so the conversation view has both sides.
 */
export async function storeOutbound(input: {
  waId: string;
  phone: string;
  type: string;
  text: string | null;
  payload?: unknown;
}): Promise<void> {
  await ensureWaInboundTables();
  await pool.query(
    `INSERT INTO wa_inbound_messages (wa_id, phone, direction, msg_type, body_text, payload)
     VALUES ($1, $2, 'outbound', $3, $4, $5)
     ON CONFLICT (wa_id) DO NOTHING`,
    [input.waId, input.phone, input.type, input.text, JSON.stringify(input.payload ?? null)],
  );
}

/* ------------------------------------------------------------------ *
 * Status callbacks (sent → delivered → read → failed)
 * ------------------------------------------------------------------ */

export async function updateMessageStatus(
  waId: string,
  status: string,
  timestamp: number,
  errorCode?: string,
  errorTitle?: string,
): Promise<void> {
  await ensureWaInboundTables();
  await pool.query(
    `UPDATE wa_inbound_messages
     SET status = $2, status_at = to_timestamp($3), error_code = COALESCE($4, error_code), error_title = COALESCE($5, error_title)
     WHERE wa_id = $1`,
    [waId, status, timestamp, errorCode ?? null, errorTitle ?? null],
  );
}

/* ------------------------------------------------------------------ *
 * Conversation state
 * ------------------------------------------------------------------ */

export type ConversationState = {
  phone: string;
  state: "bot" | "human";
  lastInboundAt: Date | null;
  assignedBookingId: string | null;
  mutedUntil: Date | null;
};

export async function getOrCreateConversation(phone: string): Promise<ConversationState> {
  await ensureWaInboundTables();
  const { rows } = await pool.query<{
    phone: string;
    state: string;
    last_inbound_at: Date | null;
    assigned_booking_id: string | null;
    muted_until: Date | null;
  }>(
    `INSERT INTO wa_conversations (phone, state) VALUES ($1, 'bot')
     ON CONFLICT (phone) DO UPDATE SET updated_at = now()
     RETURNING phone, state, last_inbound_at, assigned_booking_id, muted_until`,
    [phone],
  );
  const row = rows[0]!;
  return {
    phone: row.phone,
    state: row.state as "bot" | "human",
    lastInboundAt: row.last_inbound_at,
    assignedBookingId: row.assigned_booking_id,
    mutedUntil: row.muted_until,
  };
}

export async function touchInbound(phone: string, now = new Date()): Promise<void> {
  await pool.query(
    `UPDATE wa_conversations SET last_inbound_at = $2, updated_at = $2 WHERE phone = $1`,
    [phone, now],
  );
}

export async function setConversationState(
  phone: string,
  state: "bot" | "human",
): Promise<void> {
  await ensureWaInboundTables();
  await pool.query(
    `UPDATE wa_conversations SET state = $2, updated_at = now() WHERE phone = $1`,
    [phone, state],
  );
}

export async function setAssignedBooking(
  phone: string,
  bookingId: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE wa_conversations SET assigned_booking_id = $2, updated_at = now() WHERE phone = $1`,
    [phone, bookingId],
  );
}

/**
 * Owner inbox projection. Raw webhook payloads are intentionally not exposed.
 */
export type WaInboxConversation = {
  phone: string;
  state: "bot" | "human";
  lastInboundAt: Date | null;
  lastMessageAt: Date | null;
  lastMessageDirection: string | null;
  lastMessageText: string | null;
  lastMessageType: string | null;
};

export async function listWaConversations(limit = 100): Promise<WaInboxConversation[]> {
  await ensureWaInboundTables();
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const { rows } = await pool.query<{
    phone: string;
    state: string;
    last_inbound_at: Date | null;
    last_message_at: Date | null;
    last_message_direction: string | null;
    last_message_text: string | null;
    last_message_type: string | null;
  }>(
    `SELECT c.phone, c.state, c.last_inbound_at,
            m.created_at AS last_message_at, m.direction AS last_message_direction,
            m.body_text AS last_message_text, m.msg_type AS last_message_type
     FROM wa_conversations c
     LEFT JOIN LATERAL (
       SELECT created_at, direction, body_text, msg_type
       FROM wa_inbound_messages
       WHERE phone = c.phone
       ORDER BY created_at DESC
       LIMIT 1
     ) m ON true
     ORDER BY COALESCE(m.created_at, c.updated_at) DESC
     LIMIT $1`,
    [safeLimit],
  );
  return rows.map((row) => ({
    phone: row.phone,
    state: row.state === "human" ? "human" : "bot",
    lastInboundAt: row.last_inbound_at,
    lastMessageAt: row.last_message_at,
    lastMessageDirection: row.last_message_direction,
    lastMessageText: row.last_message_text,
    lastMessageType: row.last_message_type,
  }));
}

export type WaInboxMessage = {
  waId: string;
  direction: string;
  type: string;
  text: string | null;
  status: string | null;
  statusAt: Date | null;
  errorCode: string | null;
  errorTitle: string | null;
  createdAt: Date;
};

export async function listWaMessages(phone: string, limit = 100): Promise<WaInboxMessage[]> {
  await ensureWaInboundTables();
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const { rows } = await pool.query<{
    wa_id: string;
    direction: string;
    msg_type: string;
    body_text: string | null;
    status: string | null;
    status_at: Date | null;
    error_code: string | null;
    error_title: string | null;
    created_at: Date;
  }>(
    `SELECT wa_id, direction, msg_type, body_text, status, status_at,
            error_code, error_title, created_at
     FROM (
       SELECT wa_id, direction, msg_type, body_text, status, status_at,
              error_code, error_title, created_at
       FROM wa_inbound_messages
       WHERE phone = $1
       ORDER BY created_at DESC
       LIMIT $2
     ) recent
     ORDER BY created_at ASC`,
    [phone, safeLimit],
  );
  return rows.map((row) => ({
    waId: row.wa_id,
    direction: row.direction,
    type: row.msg_type,
    text: row.body_text,
    status: row.status,
    statusAt: row.status_at,
    errorCode: row.error_code,
    errorTitle: row.error_title,
    createdAt: row.created_at,
  }));
}

/** Fetch the last N messages for a phone (for handoff context). */
export async function recentMessages(
  phone: string,
  limit = 3,
): Promise<Array<{ direction: string; text: string | null; created_at: Date }>> {
  await ensureWaInboundTables();
  const { rows } = await pool.query<{ direction: string; body_text: string | null; created_at: Date }>(
    `SELECT direction, body_text, created_at FROM wa_inbound_messages
     WHERE phone = $1 ORDER BY created_at DESC LIMIT $2`,
    [phone, limit],
  );
  return rows.map((r) => ({ direction: r.direction, text: r.body_text, created_at: r.created_at }));
}

