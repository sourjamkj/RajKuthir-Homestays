/**
 * WhatsApp bot: decides what to reply to an inbound message.
 *
 * This is the brains — the webhook (wa-webhook.ts) stores the message and
 * calls handleInbound here. The transport (whatsapp-client.ts) sends
 * whatever we decide.
 *
 * Stub for step 1 — the menu, date parsing, quoting, LLM fallback and
 * handoff are built in later steps.
 */

import { logger } from "./logger";
import type { InboundMessage } from "./wa-webhook-rules";

/**
 * Handle an inbound WhatsApp message. Called only for new (non-duplicate)
 * messages from numbers the bot is allowed to reply to.
 *
 * In step 1 this is a no-op placeholder. Steps 3–5 fill it in.
 */
export async function handleInbound(msg: InboundMessage): Promise<void> {
  logger.info(
    { phone: msg.phone, type: msg.type, text: msg.text?.slice(0, 80) },
    "WhatsApp inbound received (bot not active yet)",
  );
}
