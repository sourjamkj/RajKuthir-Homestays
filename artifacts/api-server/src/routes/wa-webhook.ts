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
 * The POST handler verifies the signature and waits for durable storage
 * before acknowledging. Bot/agent dispatch happens after the 200 response.
 */

import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import {
  verifySignature,
  parseWebhookPayload,
  storeInbound,
  updateMessageStatus,
  shouldAutoReply,
  getOrCreateConversation,
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

router.post("/webhooks/whatsapp", async (req, res) => {
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    logger.warn("WhatsApp webhook: no raw body available for signature check");
    res.sendStatus(400);
    return;
  }

  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  if (!verifySignature(rawBody, signature)) {
    logger.warn("WhatsApp webhook: invalid signature — rejecting payload");
    res.sendStatus(401);
    return;
  }

  let parsed: ReturnType<typeof parseWebhookPayload>;
  try {
    parsed = parseWebhookPayload(req.body);
  } catch (error) {
    logger.warn({ err: error }, "WhatsApp webhook payload could not be parsed");
    res.sendStatus(400);
    return;
  }

  // Meta is acknowledged only after every message and status update in this
  // delivery is durable. ON CONFLICT makes Meta retries safe and idempotent.
  const newMessages: ReturnType<typeof parseWebhookPayload>["messages"] = [];
  try {
    for (const msg of parsed.messages) {
      const isNew = await storeInbound(msg);
      if (isNew) newMessages.push(msg);
    }
    for (const st of parsed.statuses) {
      await updateMessageStatus(st.waId, st.status, st.timestamp, st.errorCode, st.errorTitle);
    }
  } catch (error) {
    logger.error({ err: error }, "WhatsApp webhook persistence failed; asking Meta to retry");
    res.sendStatus(503);
    return;
  }

  res.sendStatus(200);
  if (newMessages.length) {
    void dispatchNewMessages(newMessages, parsed.messages.length, rawBody, signature!);
  }
});

/**
 * Dispatch only newly persisted messages. A human-owned conversation is never
 * forwarded to the AI agent. For Hermes, forward the original signed body only
 * when every inbound message in the delivery is eligible; this avoids leaking
 * a human-owned chat from a mixed webhook batch into the agent.
 */
async function dispatchNewMessages(
  messages: ReturnType<typeof parseWebhookPayload>["messages"],
  payloadMessageCount: number,
  rawBody: Buffer,
  signature: string,
): Promise<void> {
  const hermesUrl = process.env["HERMES_WEBHOOK_URL"]?.trim();
  const eligible: typeof messages = [];

  for (const msg of messages) {
    try {
      const conversation = await getOrCreateConversation(msg.phone);
      if (conversation.state === "human") {
        logger.info({ phone: msg.phone }, "WhatsApp AI dispatch skipped: conversation is human-owned");
        continue;
      }
      if (shouldAutoReply(msg.phone)) eligible.push(msg);
    } catch (error) {
      logger.error({ err: error, phone: msg.phone }, "Could not check WhatsApp conversation ownership");
    }
  }

  if (!eligible.length) return;

  if (hermesUrl) {
    if (eligible.length !== payloadMessageCount || messages.length !== payloadMessageCount) {
      logger.warn(
        { eligible: eligible.length, newMessages: messages.length, payloadMessages: payloadMessageCount },
        "Hermes dispatch skipped for mixed or partially duplicated webhook delivery",
      );
      return;
    }
    await forwardToHermes(hermesUrl, rawBody, signature);
    return;
  }

  for (const msg of eligible) {
    try {
      const { handleInbound } = await import("../lib/wa-bot");
      void handleInbound(msg).catch((error) => {
        logger.error({ err: error, phone: msg.phone }, "WhatsApp bot handler failed");
      });
    } catch (error) {
      logger.error({ err: error, phone: msg.phone }, "Failed to dispatch to WhatsApp bot");
    }
  }
}

async function forwardToHermes(url: string, rawBody: Buffer, signature: string): Promise<void> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": signature },
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, "Hermes agent refused a forwarded WhatsApp message");
    }
  } catch (error) {
    logger.error({ err: error }, "Could not reach the Hermes agent");
  }
}

export default router;
