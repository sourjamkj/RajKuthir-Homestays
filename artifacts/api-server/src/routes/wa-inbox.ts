import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

import { requireAdmin } from "../lib/admin-auth";
import { logger } from "../lib/logger";
import { HANDOFF_HOURS } from "../lib/wa-agent-rules";
import { ensureWaInboundTables, isWithin24h, storeOutbound } from "../lib/wa-webhook";
import { sendText } from "../lib/whatsapp-client";

/**
 * The owner's WhatsApp inbox for +91 84201 13934. The number runs on the
 * Cloud API, so it cannot be opened in the WhatsApp app: this is where the
 * owner reads guests' chats, replies, and takes a chat over from the
 * assistant or hands it back.
 */
const router: IRouter = Router();

const PHONE = /^\d{8,15}$/;

router.get("/admin/wa/conversations", requireAdmin, async (_req, res) => {
  await ensureWaInboundTables();
  const { rows } = await pool.query(
    `SELECT c.phone, c.state, c.muted_until AS "mutedUntil", c.last_inbound_at AS "lastInboundAt",
            m.body_text AS "lastText", m.direction AS "lastDirection", m.created_at AS "lastAt"
     FROM wa_conversations c
     LEFT JOIN LATERAL (
       SELECT body_text, direction, created_at FROM wa_inbound_messages
       WHERE phone = c.phone ORDER BY created_at DESC LIMIT 1
     ) m ON true
     ORDER BY m.created_at DESC NULLS LAST
     LIMIT 100`,
  );
  res.setHeader("Cache-Control", "no-store");
  res.json({ conversations: rows });
});

router.get("/admin/wa/conversations/:phone", requireAdmin, async (req, res) => {
  const phone = String(req.params.phone);
  if (!PHONE.test(phone)) return void res.status(400).json({ error: "Not a phone number." });
  await ensureWaInboundTables();
  const { rows } = await pool.query(
    `SELECT id, direction, msg_type AS type, body_text AS text, status, created_at AS "at" FROM (
       SELECT * FROM wa_inbound_messages WHERE phone = $1 ORDER BY created_at DESC LIMIT 150
     ) recent ORDER BY created_at ASC`,
    [phone],
  );
  res.setHeader("Cache-Control", "no-store");
  res.json({ messages: rows });
});

/** Owner's reply. Only inside WhatsApp's 24-hour window after the guest's last message. Takes the chat from the assistant. */
router.post("/admin/wa/conversations/:phone/reply", requireAdmin, async (req, res) => {
  const phone = String(req.params.phone);
  const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 4000) : "";
  if (!PHONE.test(phone) || !text) return void res.status(400).json({ error: "A message is needed." });
  await ensureWaInboundTables();
  const { rows } = await pool.query<{ last_inbound_at: Date | null }>(`SELECT last_inbound_at FROM wa_conversations WHERE phone = $1`, [phone]);
  if (!isWithin24h(rows[0]?.last_inbound_at ?? null)) {
    return void res.status(409).json({ error: "More than 24 hours since the guest last wrote, so WhatsApp only allows approved templates. Call them, or wait for them to write." });
  }
  const sent = await sendText({ to: phone, text });
  if (!sent.ok) return void res.status(502).json({ error: sent.error });
  await storeOutbound({ waId: sent.providerMessageId, phone, type: "text", text });
  await pool.query(`UPDATE wa_conversations SET state = 'human', muted_until = $2, updated_at = now() WHERE phone = $1`, [
    phone,
    new Date(Date.now() + HANDOFF_HOURS * 3_600_000),
  ]);
  logger.info({ phone }, "Owner replied on WhatsApp");
  res.json({ ok: true });
});

/** "You answer" (the assistant stays quiet for 24 hours) or "Assistant answers". */
router.post("/admin/wa/conversations/:phone/state", requireAdmin, async (req, res) => {
  const phone = String(req.params.phone);
  const state = req.body?.state;
  if (!PHONE.test(phone) || (state !== "bot" && state !== "human")) return void res.status(400).json({ error: "state must be bot or human." });
  await ensureWaInboundTables();
  await pool.query(`UPDATE wa_conversations SET state = $2, muted_until = $3, updated_at = now() WHERE phone = $1`, [
    phone,
    state,
    state === "human" ? new Date(Date.now() + HANDOFF_HOURS * 3_600_000) : null,
  ]);
  res.json({ ok: true });
});

export default router;
