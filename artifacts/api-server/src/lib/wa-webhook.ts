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
import { logger } from "./logger";

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
 * Stores an inbound message. Returns true if it was new, false if it was
 * a duplicate (same wa_id). Never throws — a storage failure is logged
 * and swallowed so the 200 still goes back to Meta.
 */
export async function storeInbound(msg: _InboundMessage): Promise<boolean> {
  try {
    await ensureWaInboundTables();
    const result = await pool.query(
      `INSERT INTO wa_inbound_messages (wa_id, phone, direction, msg_type, body_text, payload, created_at)
       VALUES ($1, $2, 'inbound', $3, $4, $5, to_timestamp($6))
       ON CONFLICT (wa_id) DO NOTHING`,
      [msg.waId, msg.phone, msg.type, msg.text, JSON.stringify(msg.payload), msg.timestamp],
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    logger.error({ err: error, waId: msg.waId }, "Failed to store inbound WhatsApp message");
    return false;
  }
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
  try {
    await ensureWaInboundTables();
    await pool.query(
      `INSERT INTO wa_inbound_messages (wa_id, phone, direction, msg_type, body_text, payload)
       VALUES ($1, $2, 'outbound', $3, $4, $5)
       ON CONFLICT (wa_id) DO NOTHING`,
      [input.waId, input.phone, input.type, input.text, JSON.stringify(input.payload ?? null)],
    );
  } catch (error) {
    logger.error({ err: error }, "Failed to store outbound WhatsApp message");
  }
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
  try {
    await ensureWaInboundTables();
    await pool.query(
      `UPDATE wa_inbound_messages
       SET status = $2, status_at = to_timestamp($3), error_code = COALESCE($4, error_code), error_title = COALESCE($5, error_title)
       WHERE wa_id = $1`,
      [waId, status, timestamp, errorCode ?? null, errorTitle ?? null],
    );
  } catch (error) {
    logger.error({ err: error, waId }, "Failed to update WhatsApp message status");
  }
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

