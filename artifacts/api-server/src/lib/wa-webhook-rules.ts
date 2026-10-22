/**
 * Pure functions for the WhatsApp webhook layer.
 *
 * Split out of wa-webhook.ts so tests can run without @workspace/db (which
 * opens a connection pool at import time and throws without DATABASE_URL).
 *
 * Everything here is deterministic and side-effect-free except for reading
 * process.env — no logger, no pool, no I/O.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Normalise a phone number for WhatsApp. Duplicates the logic from
 * whatsapp-client.ts rather than importing it — that file's import
 * chain pulls in ./logger which uses bare module specifiers that
 * break under `node --test`.
 */
function toWhatsappNumber(raw: string | null | undefined): string | null {
  const DEFAULT_COUNTRY =
    process.env["WHATSAPP_DEFAULT_COUNTRY"]?.replace(/\D/g, "") || "91";
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = DEFAULT_COUNTRY + digits;
  if (digits.length < 11 || digits.length > 15) return null;
  return digits;
}

/* ------------------------------------------------------------------ *
 * Configuration helpers
 * ------------------------------------------------------------------ */

export function isAutoReplyEnabled(): boolean {
  return process.env["WHATSAPP_AUTOREPLY_ENABLED"] === "true";
}

export function testNumbers(): Set<string> {
  const raw = process.env["WHATSAPP_TEST_NUMBERS"]?.trim() ?? "";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

/** Whether the bot should reply to this number. */
export function shouldAutoReply(phone: string): boolean {
  if (isAutoReplyEnabled()) return true;
  return testNumbers().has(phone);
}

/* ------------------------------------------------------------------ *
 * Signature verification
 * ------------------------------------------------------------------ */

/**
 * Verifies the X-Hub-Signature-256 header against the raw body.
 * Returns true if the signature is valid, false otherwise.
 */
export function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  const secret = process.env["WHATSAPP_APP_SECRET"]?.trim() ?? "";
  if (!secret) return false;
  if (!signatureHeader) return false;

  const parts = signatureHeader.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = parts[1]!;

  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

/* ------------------------------------------------------------------ *
 * 24h window check
 * ------------------------------------------------------------------ */

/** True if the last inbound is within the 24h window. */
export function isWithin24h(lastInbound: Date | null, now = new Date()): boolean {
  if (!lastInbound) return false;
  return now.getTime() - lastInbound.getTime() < 24 * 60 * 60 * 1000;
}

/* ------------------------------------------------------------------ *
 * Parse the Cloud API webhook payload
 * ------------------------------------------------------------------ */

export type InboundMessage = {
  waId: string;
  phone: string;
  type: string;
  text: string | null;
  payload: unknown;
  timestamp: number;
};

type WaWebhookEntry = {
  changes?: Array<{
    value?: {
      messaging_product?: string;
      metadata?: { phone_number_id?: string };
      messages?: Array<{
        id?: string;
        from?: string;
        timestamp?: string;
        type?: string;
        text?: { body?: string };
        interactive?: { type?: string; button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } };
        [key: string]: unknown;
      }>;
      statuses?: Array<{
        id?: string;
        status?: string;
        timestamp?: string;
        errors?: Array<{ code?: number; title?: string }>;
      }>;
    };
  }>;
};

export type ParsedInbound = {
  messages: InboundMessage[];
  statuses: Array<{ waId: string; status: string; timestamp: number; errorCode?: string; errorTitle?: string }>;
};

export function parseWebhookPayload(body: unknown): ParsedInbound {
  const result: ParsedInbound = { messages: [], statuses: [] };
  const payload = body as { entry?: WaWebhookEntry[] };
  if (!payload.entry) return result;

  for (const entry of payload.entry) {
    if (!entry.changes) continue;
    for (const change of entry.changes) {
      const value = change.value;
      if (!value || value.messaging_product !== "whatsapp") continue;

      // Inbound messages
      if (value.messages) {
        for (const msg of value.messages) {
          if (!msg.id || !msg.from || !msg.timestamp) continue;
          const phone = toWhatsappNumber(msg.from);
          if (!phone) continue;

          let text: string | null = null;
          if (msg.type === "text") {
            text = msg.text?.body ?? null;
          } else if (msg.type === "interactive") {
            const interactive = msg.interactive;
            if (interactive?.type === "button_reply") {
              text = interactive.button_reply?.id ?? null;
            } else if (interactive?.type === "list_reply") {
              text = interactive.list_reply?.id ?? null;
            }
          }

          result.messages.push({
            waId: msg.id,
            phone,
            type: msg.type ?? "unknown",
            text,
            payload: msg,
            timestamp: Number(msg.timestamp),
          });
        }
      }

      // Status callbacks
      if (value.statuses) {
        for (const st of value.statuses) {
          if (!st.id || !st.status || !st.timestamp) continue;
          result.statuses.push({
            waId: st.id,
            status: st.status,
            timestamp: Number(st.timestamp),
            errorCode: st.errors?.[0]?.code?.toString(),
            errorTitle: st.errors?.[0]?.title,
          });
        }
      }
    }
  }

  return result;
}
