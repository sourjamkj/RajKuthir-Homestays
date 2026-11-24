import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/admin-auth";
import { isWithin24h } from "../lib/wa-webhook-rules";
import {
  getOrCreateConversation,
  listWaConversations,
  listWaMessages,
  setConversationState,
  storeOutbound,
  updateMessageStatus,
} from "../lib/wa-webhook";
import { isWhatsappEnabled, sendText, toWhatsappNumber } from "../lib/whatsapp-client";

const router: IRouter = Router();

function phoneFromParam(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 32) return null;
  return toWhatsappNumber(value);
}

function limitFromQuery(value: unknown, fallback = 100): number {
  const parsed = typeof value === "string" ? Number(value) : fallback;
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 200) : fallback;
}

router.use("/admin/whatsapp", requireAdmin);

/** Owner-only inbox conversation summaries. */
router.get("/admin/whatsapp/conversations", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const rows = await listWaConversations(100);
  res.json({
    conversations: rows.map((row) => ({
      ...row,
      replyWindowOpen: isWithin24h(row.lastInboundAt),
    })),
  });
});

/** Owner-only message history for one guest. Raw provider payloads are withheld. */
router.get("/admin/whatsapp/conversations/:phone/messages", async (req, res) => {
  const phone = phoneFromParam(Array.isArray(req.params.phone) ? null : req.params.phone);
  if (!phone) {
    res.status(400).json({ error: "Invalid WhatsApp phone number." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ phone, messages: await listWaMessages(phone, limitFromQuery(req.query.limit)) });
});

/** Human takeover is sticky until the owner explicitly resumes the agent. */
router.post("/admin/whatsapp/conversations/:phone/takeover", async (req, res) => {
  const phone = phoneFromParam(Array.isArray(req.params.phone) ? null : req.params.phone);
  if (!phone) {
    res.status(400).json({ error: "Invalid WhatsApp phone number." });
    return;
  }
  await getOrCreateConversation(phone);
  await setConversationState(phone, "human");
  res.json({ phone, state: "human" });
});

router.post("/admin/whatsapp/conversations/:phone/resume", async (req, res) => {
  const phone = phoneFromParam(Array.isArray(req.params.phone) ? null : req.params.phone);
  if (!phone) {
    res.status(400).json({ error: "Invalid WhatsApp phone number." });
    return;
  }
  await getOrCreateConversation(phone);
  await setConversationState(phone, "bot");
  res.json({ phone, state: "bot" });
});

/**
 * Manual text reply. It deliberately uses free-form text only while the
 * WhatsApp 24-hour customer-service window is open. Outside that window the
 * owner must use an approved template via the existing template workflow.
 */
router.post("/admin/whatsapp/conversations/:phone/reply", async (req, res) => {
  const phone = phoneFromParam(Array.isArray(req.params.phone) ? null : req.params.phone);
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!phone || !text || text.length > 4096) {
    res.status(400).json({ error: "Enter a valid phone number and a message of 1–4096 characters." });
    return;
  }
  if (!isWhatsappEnabled()) {
    res.status(503).json({ error: "WhatsApp sending is disabled or not configured." });
    return;
  }

  const conversation = await getOrCreateConversation(phone);
  if (!isWithin24h(conversation.lastInboundAt)) {
    res.status(409).json({
      error: "The 24-hour customer-service window is closed. Use an approved WhatsApp template instead.",
      code: "outside_customer_service_window",
    });
    return;
  }

  // Claim the conversation before sending so an incoming message cannot be
  // answered by the agent while the owner is taking over.
  await setConversationState(phone, "human");
  const result = await sendText({ to: phone, text });
  if (!result.ok) {
    res.status(result.retryable ? 502 : 503).json({ error: result.error, retryable: result.retryable });
    return;
  }

  // Persist the provider ID before reporting success to the owner. Meta status
  // webhooks will subsequently advance this row to delivered/read/failed.
  await storeOutbound({
    waId: result.providerMessageId,
    phone,
    type: "text",
    text,
    payload: { source: "owner_inbox" },
  });
  await updateMessageStatus(result.providerMessageId, "sent", Math.floor(Date.now() / 1000));
  res.json({ sent: true, phone, state: "human", providerMessageId: result.providerMessageId });
});

export default router;
