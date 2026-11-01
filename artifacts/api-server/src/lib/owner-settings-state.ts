import {
  eventEnabled,
  inQuietHours,
  resolveAlertEmail,
  resolveAutoreply,
  resolveCaretakerName,
  resolveCaretakerWhatsapp,
  resolveOwnerSignature,
  resolveOwnerWhatsapp,
  resolveWhatsappMode,
  type OwnerEvent,
  type StoredOwnerSettings,
  type WhatsappMode,
} from "./owner-settings-rules.ts";

/**
 * The owner's settings as currently loaded, and the effective values the rest
 * of the server reads. No database import here, so pure rule modules (and
 * their tests) can use the getters; owner-settings.ts loads and saves.
 *
 * Empty until the first load, and every getter then falls back to the
 * Railway variables and old defaults: how the server behaved before.
 */
let current: StoredOwnerSettings = {};

export function setOwnerSettingsState(next: StoredOwnerSettings): void {
  current = next;
}

export function storedOwnerSettings(): StoredOwnerSettings {
  return current;
}

export const ownerAlertEmailSetting = (): string | null => resolveAlertEmail(current, process.env).value;
export const ownerWhatsappNumber = (): string => resolveOwnerWhatsapp(current, process.env).value;
/** Only a number the owner actually set (console or Railway), never the built-in default. */
export const ownerWhatsappNumberIfSet = (): string | null => {
  const r = resolveOwnerWhatsapp(current, process.env);
  return r.source === "default" ? null : r.value;
};
export const caretakerWhatsappNumber = (): string => resolveCaretakerWhatsapp(current, process.env).value;
export const caretakerName = (): string | null => resolveCaretakerName(current).value;
export const ownerSignature = (): string => resolveOwnerSignature(current).value;
export const autoreplyEnabled = (): boolean => resolveAutoreply(current, process.env).value;
export const whatsappMode = (): WhatsappMode => resolveWhatsappMode(current, process.env).value;
export const pushEnabledFor = (event: OwnerEvent): boolean => eventEnabled(current.pushEvents, event, "push");
export const emailEnabledFor = (event: OwnerEvent): boolean => eventEnabled(current.emailEvents, event, "email");
export const quietHoursNow = (now: Date): boolean => inQuietHours(current.quietHours, now);
