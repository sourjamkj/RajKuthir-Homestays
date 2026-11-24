import { isAllowedOwnerTelegramTarget } from "./telegram-owner-rules";

/**
 * Sends only to Ryan's configured owner home channel, and only if that
 * positive numeric user ID is also in TELEGRAM_ALLOWED_USERS. No polling,
 * command handling or second bot is introduced here: Ryan remains the sole
 * Telegram operator and owns inbound Telegram updates.
 */

export type TelegramOwnerSend =
  | { configured: false; ok: false; reason: "not_configured" }
  | { configured: true; ok: true }
  | { configured: true; ok: false; reason: string };

export function ownerTelegramTarget(): { token: string; chatId: string } | null {
  const token = process.env["TELEGRAM_BOT_TOKEN"]?.trim();
  const chatId = process.env["TELEGRAM_HOME_CHANNEL"]?.trim();
  const allowed = process.env["TELEGRAM_ALLOWED_USERS"];
  if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) return null;
  if (!isAllowedOwnerTelegramTarget(chatId, allowed)) return null;
  return { token, chatId: chatId! };
}

export async function sendOwnerTelegramMessage(text: string): Promise<TelegramOwnerSend> {
  const config = ownerTelegramTarget();
  if (!config) return { configured: false, ok: false, reason: "not_configured" };
  const message = text.trim().slice(0, 4000);
  if (!message) return { configured: true, ok: false, reason: "empty_message" };

  try {
    const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: message,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      // Never log or return the request URL: it contains the bot token.
      return { configured: true, ok: false, reason: `telegram_http_${response.status}` };
    }
    const body = (await response.json().catch(() => null)) as { ok?: boolean } | null;
    return body?.ok
      ? { configured: true, ok: true }
      : { configured: true, ok: false, reason: "telegram_api_rejected" };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      reason: error instanceof Error && error.name === "TimeoutError" ? "telegram_timeout" : "telegram_network_error",
    };
  }
}
