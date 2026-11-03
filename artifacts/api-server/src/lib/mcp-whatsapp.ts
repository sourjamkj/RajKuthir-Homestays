import { toWhatsappNumber } from "./whatsapp-client";

/** A wa.me link with the text filled in, for the owner to tap and send from his own WhatsApp. */
export function manualWhatsappLinkFor(phone: string, text: string): string | null {
  const to = toWhatsappNumber(phone);
  return to ? `https://wa.me/${to}?text=${encodeURIComponent(text)}` : null;
}
