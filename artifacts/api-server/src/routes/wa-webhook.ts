/**
 * WhatsApp Cloud API webhook endpoint.
 *
 * Mounted directly on the Express app (not under /api) because Meta's
 * webhook verification sends a plain GET that must return hub.challenge
 * as-is.
 *
 *   GET  /webhooks/whatsapp   — verification handshake
 *   POST /webhooks/whatsapp   — inbound messages and status callbacks
 *
 * The POST handler responds 200 immediately and processes async, as
 * Meta requires. It never blocks on database writes or bot replies.
 */

import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import {
  verifySignature,
  parseWebhookPayload,
  storeInbound,
  updateMessageStatus,
  touchInbound,
  shouldAutoReply,
} from "../lib/wa-webhook";

const router: IRouter = Router();

/* ------------------------------------------------------------------ *
 * GET: Meta's verification handshake
 * ------------------------------------------------------------------ */

router.get("/webhooks/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const verifyToken = process.env["WHATSAPP_VERIFY_TOKEN"]?.trim();
  if (!verifyToken) {
    logger.warn("WHATSAPP_VERIFY_TOKEN is not set — webhook verification will fail");
    res.sendStatus(403);
    return;
  }

  if (mode === "subscribe" && token === verifyToken) {
    logger.info("WhatsApp webhook verified");
    res.status(200).send(challenge);
    return;
  }

  logger.warn({ mode, tokenMatch: token === verifyToken }, "WhatsApp webhook verification failed");
  res.sendStatus(403);
});

/* ------------------------------------------------------------------ *
 * POST: inbound messages and status callbacks
 *
 * The raw body is stashed on req by the verify callback in app.ts so
 * we can check the HMAC signature. If the body is not a Buffer (e.g.
 * the middleware was not set up), we reject the request.
 * ------------------------------------------------------------------ */

router.post("/webhooks/whatsapp", (req, res) => {
  // Always respond 200 immediately — Meta retries on anything else.
  res.sendStatus(200);

  // Signature check
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    logger.warn("WhatsApp webhook: no raw body available for signature check");
    return;
  }

  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  if (!verifySignature(rawBody, signature)) {
    logger.warn("WhatsApp webhook: invalid signature — ignoring payload");
    return;
  }

  // Parse and process async (fire-and-forget after the 200)
  void processPayload(req.body);
});

async function processPayload(body: unknown): Promise<void> {
  try {
    const parsed = parseWebhookPayload(body);

    // Store inbound messages
    for (const msg of parsed.messages) {
      const isNew = await storeInbound(msg);
      if (!isNew) continue; // Duplicate delivery

      // Touch the conversation's last_inbound_at
      await touchInbound(msg.phone, new Date(msg.timestamp * 1000));

      // Dispatch to the bot (lazy-imported to keep this file light)
      if (shouldAutoReply(msg.phone)) {
        try {
          const { handleInbound } = await import("../lib/wa-bot");
          void handleInbound(msg);
        } catch (error) {
          logger.error({ err: error, phone: msg.phone }, "Failed to dispatch to WhatsApp bot");
        }
      }
    }

    // Update statuses
    for (const st of parsed.statuses) {
      await updateMessageStatus(st.waId, st.status, st.timestamp, st.errorCode, st.errorTitle);
    }
  } catch (error) {
    logger.error({ err: error }, "WhatsApp webhook processing failed");
  }
}

export default router;
