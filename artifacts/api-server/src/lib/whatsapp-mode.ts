import { isWhatsappEnabled } from "./whatsapp-client";
import { whatsappMode } from "./owner-settings-state";

/**
 * Whether messages to guests go out through the WhatsApp Business API right
 * now: the API is switched on (Railway) AND the owner's Settings say "api".
 * In "manual" mode the same messages wait in the outbox for the owner to send
 * from their own WhatsApp (and mark sent), so nothing reaches a guest twice.
 *
 * Owner-only alerts and the inbound auto-reply are not guest sends and keep
 * their own switches.
 */
export function guestApiSendingOn(): boolean {
  return isWhatsappEnabled() && whatsappMode() === "api";
}
