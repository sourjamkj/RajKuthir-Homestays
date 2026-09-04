import { logger } from "./logger";

/**
 * Transport for Meta's WhatsApp Cloud API.
 *
 * Deliberately the only file that knows the provider exists — everything
 * upstream deals in `sendTemplate(...)`, so swapping to a BSP (Twilio,
 * Gupshup, 360dialog) means rewriting this file and nothing else.
 *
 * Required environment:
 *   WHATSAPP_ENABLED           "true" to actually send. Anything else and
 *                              messages are queued and previewed but never
 *                              leave the building. Off by default on purpose.
 *   WHATSAPP_PHONE_NUMBER_ID   from Meta > WhatsApp > API Setup
 *   WHATSAPP_ACCESS_TOKEN      permanent system-user token, not the 24h one
 *   WHATSAPP_DEFAULT_COUNTRY   digits, no '+'. Defaults to 91 (India).
 */

const GRAPH_VERSION = "v21.0";

const ENABLED = process.env["WHATSAPP_ENABLED"] === "true";
const PHONE_NUMBER_ID = process.env["WHATSAPP_PHONE_NUMBER_ID"]?.trim();
const ACCESS_TOKEN = process.env["WHATSAPP_ACCESS_TOKEN"]?.trim();
const DEFAULT_COUNTRY =
  process.env["WHATSAPP_DEFAULT_COUNTRY"]?.replace(/\D/g, "") || "91";

export function isWhatsappConfigured(): boolean {
  return Boolean(PHONE_NUMBER_ID && ACCESS_TOKEN);
}

/** Sending is a two-key switch: configured *and* explicitly enabled. */
export function isWhatsappEnabled(): boolean {
  return ENABLED && isWhatsappConfigured();
}

/**
 * Turns however a number was written into what the Cloud API wants: digits
 * only, country code included, no '+'.
 *
 * The same guest arrives as "+91 62903 99165" from one channel, "06290399165"
 * from another and "6290399165" typed into the enquiry form. All three are
 * one person and one WhatsApp account.
 *
 * Returns null rather than guessing when the number cannot be trusted — a
 * wrong number here means messaging a stranger.
 */
export function toWhatsappNumber(raw: string | null | undefined): string | null {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;

  // Some sources write the international prefix as 00 rather than +.
  if (digits.startsWith("00")) digits = digits.slice(2);

  // A single leading 0 is the Indian domestic trunk prefix, not part of the
  // number: 06290399165 -> 6290399165.
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  // Bare national number: add the country code.
  if (digits.length === 10) digits = DEFAULT_COUNTRY + digits;

  // E.164 allows 8-15 digits including the country code. Anything outside
  // that is a typo, an extension, or a landline written oddly.
  if (digits.length < 11 || digits.length > 15) return null;

  return digits;
}

export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string; retryable: boolean };

/**
 * Sends one pre-approved template.
 *
 * Business-initiated WhatsApp messages must use a template Meta has approved;
 * free-form text is only allowed inside the 24-hour window after the guest
 * messages first. Everything this app sends is business-initiated, so
 * everything here is a template.
 */
export async function sendTemplate(input: {
  to: string;
  templateName: string;
  languageCode?: string;
  params: string[];
}): Promise<SendResult> {
  if (!isWhatsappEnabled()) {
    return {
      ok: false,
      error: "WhatsApp sending is disabled or not configured.",
      retryable: false,
    };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "template",
        template: {
          name: input.templateName,
          language: { code: input.languageCode ?? "en" },
          components: input.params.length
            ? [
                {
                  type: "body",
                  parameters: input.params.map((text) => ({
                    type: "text",
                    text,
                  })),
                },
              ]
            : [],
        },
      }),
    });

    const body = (await response.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string; code?: number };
    };

    if (!response.ok) {
      const message = body.error?.message ?? `HTTP ${response.status}`;
      // 4xx other than 429 means the request itself is wrong — a bad number,
      // an unapproved template, a revoked token. Retrying cannot fix any of
      // those, and retrying a bad number just annoys whoever owns it.
      const retryable = response.status === 429 || response.status >= 500;

      logger.warn(
        { status: response.status, code: body.error?.code, message },
        "WhatsApp send rejected",
      );
      return { ok: false, error: message, retryable };
    }

    const providerMessageId = body.messages?.[0]?.id;
    if (!providerMessageId) {
      return { ok: false, error: "Provider returned no message id.", retryable: true };
    }

    return { ok: true, providerMessageId };
  } catch (error) {
    // Network failure or the 15s abort — worth another go.
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Network error.",
      retryable: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}
