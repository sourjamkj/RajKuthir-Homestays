/**
 * The number as typed on the pre-arrival form, in a shape WhatsApp accepts.
 * The form takes Indian mobiles with or without +91, and the odd foreign
 * number with its own country code; a bare ten digits is assumed Indian.
 */
export function whatsappReadyPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}
