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
 * The POST handler verifies authenticity and waits until inbound events are
 * durably stored before acknowledging them, so Meta retries storage failures.
 */

import { Router, type IRouter } from "express";
import { createHmac } from "node:crypto";
import { logger } from "../lib/logger";
import {
  verifySignature,
  parseWebhookPayload,
  storeInbound,
  updateMessageStatus,
  touchInbound,
  shouldAutoReply,
} from "../lib/wa-webhook";
import {
  expectedPhoneNumberIdMatches,
  parseWaFlowAnswers,
} from "../lib/wa-flow-rules.ts";
import { acceptWaFlowSubmission } from "../lib/wa-flow-enquiry";
import { sendBookingEnquiryFlow } from "../lib/whatsapp-client";
import { filterWebhookForHermes } from "../lib/wa-webhook-rules.ts";

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
    logger.warn(
      "WHATSAPP_VERIFY_TOKEN is not set — webhook verification will fail",
    );
    res.sendStatus(403);
    return;
  }

  if (mode === "subscribe" && token === verifyToken) {
    logger.info("WhatsApp webhook verified");
    res.status(200).send(challenge);
    return;
  }

  logger.warn(
    { mode, tokenMatch: token === verifyToken },
    "WhatsApp webhook verification failed",
  );
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
  if (
    !req.body ||
    typeof req.body !== "object" ||
    !Array.isArray((req.body as { entry?: unknown }).entry)
  ) {
    res.sendStatus(400);
    return;
  }
  // Signature check
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    logger.warn("WhatsApp webhook: no raw body available for signature check");
    res.sendStatus(400);
    return;
  }

  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  if (!verifySignature(rawBody, signature)) {
    logger.warn("WhatsApp webhook: invalid signature — ignoring payload");
    res.sendStatus(401);
    return;
  }
  try {
    await processPayload(req.body);
    res.sendStatus(200);
  } catch (error) {
    // In particular, let Meta retry when durable storage failed.
    logger.error(
      { err: error },
      "WhatsApp webhook processing failed before durable acceptance",
    );
    res.sendStatus(503);
  }
});

/**
 * Hands only explicitly selected ordinary guest messages to Hermes. The
 * filtered body is signed with the same Meta app secret for Hermes verification.
 */
async function forwardToHermes(url: string, body: unknown): Promise<void> {
  const secret = process.env["WHATSAPP_APP_SECRET"]?.trim() ?? "";
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
      },
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
      logger.warn(
        { status: res.status },
        "Hermes agent refused a forwarded WhatsApp message",
      );
  } catch (error) {
    logger.error({ err: error }, "Could not reach the Hermes agent");
  }
}

async function processPayload(body: unknown): Promise<void> {
  // Who answers chats: Hermes when HERMES_WEBHOOK_URL is set, else the built-in bot.
  const hermesUrl = process.env["HERMES_WEBHOOK_URL"]?.trim();
  const parsed = parseWebhookPayload(body);
  const permittedMessageIds: string[] = [];
  const permittedFlowIds: string[] = [];

  // Store inbound messages
  for (const msg of parsed.messages) {
    if (!expectedPhoneNumberIdMatches(msg.phoneNumberId)) {
      logger.warn(
        { waId: msg.waId },
        "WhatsApp event did not match configured business phone number",
      );
      continue;
    }
    const isNew = await storeInbound(msg); // durable and conflict-safe
    const isFlow =
      msg.type === "interactive" &&
      (msg.payload as { interactive?: { type?: string } })?.interactive
        ?.type === "nfm_reply";
    if (!isNew && !isFlow) continue; // avoid duplicate bot replies; Flow retries re-enter the idempotent enquiry service.

    // Touch the conversation's last_inbound_at
    await touchInbound(msg.phone, new Date(msg.timestamp * 1000));

    // Pilot numbers only, until auto-reply is switched on in Settings.
    if (isFlow) continue; // Never forward the Flow payload or unrelated batch members with it.
    if (
      shouldAutoReply(msg.phone) &&
      /^(enquiry|booking enquiry|check dates|availability|plan (my|a) stay)$/i.test(
        msg.text?.trim() ?? "",
      )
    ) {
      const result = await sendBookingEnquiryFlow({ to: msg.phone });
      if (!result.ok)
        logger.warn(
          { retryable: result.retryable },
          "Could not launch the WhatsApp booking Flow",
        );
      continue;
    }
    if (shouldAutoReply(msg.phone) && hermesUrl) {
      permittedMessageIds.push(msg.waId);
    } else if (shouldAutoReply(msg.phone)) {
      try {
        const { handleInbound } = await import("../lib/wa-bot");
        void handleInbound(msg);
      } catch (error) {
        logger.error(
          { err: error, phone: msg.phone },
          "Failed to dispatch to WhatsApp bot",
        );
      }
    }
  }

  // Process authenticated Flow submissions using the sender number from Meta, never a Flow field.
  for (const flow of parsed.flows) {
    if (
      !expectedPhoneNumberIdMatches(flow.phoneNumberId) ||
      !shouldAutoReply(flow.phone)
    )
      continue;
    if (!parseWaFlowAnswers(flow.responseJson)) {
      logger.warn(
        { waId: flow.waId },
        "Malformed WhatsApp booking Flow response",
      );
      continue;
    }
    const accepted = await acceptWaFlowSubmission({
      messageId: flow.waId,
      senderPhone: flow.phone,
      responseJson: flow.responseJson,
    });
    // Hermes sees only this authenticated, validated Flow submission so it can
    // use the guest tool for the matching quote. The API already sent the
    // required acceptance message; Hermes must not repeat it.
    if (accepted.newlyCreated && hermesUrl) permittedFlowIds.push(flow.waId);
  }

  if (permittedMessageIds.length && hermesUrl) {
    const filtered = filterWebhookForHermes(body, new Set(permittedMessageIds));
    await forwardToHermes(hermesUrl, filtered);
  }
  if (permittedFlowIds.length && hermesUrl) {
    const filtered = filterWebhookForHermes(
      body,
      new Set(permittedFlowIds),
      true,
    );
    await forwardToHermes(hermesUrl, filtered);
  }

  // Update statuses
  for (const st of parsed.statuses) {
    await updateMessageStatus(
      st.waId,
      st.status,
      st.timestamp,
      st.errorCode,
      st.errorTitle,
    );
  }
}

export default router;
