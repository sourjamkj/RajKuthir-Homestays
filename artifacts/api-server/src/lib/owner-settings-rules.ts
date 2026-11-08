/**
 * The owner's Settings console: everyday toggles, contacts and alert routing,
 * edited from the web console or the phone app without a redeploy.
 *
 * Pure rules. The stored document lives in app_settings under one key
 * (owner-settings.ts). Every field is optional in storage: an unset field
 * falls back to its Railway variable, then to the old built-in default, so
 * deploying this changes nothing until the owner saves a value.
 *
 * Deliberately NOT here: anything that moves money or grants access (UPI ID,
 * admin password, session secret, WhatsApp/mail/API keys). Those stay Railway
 * variables, and the console only shows whether each one is set.
 */

export const OWNER_SETTINGS_KEY = "owner.settings";

export type WhatsappMode = "manual" | "api";

/** Everything the owner can be alerted about. Push wiring arrives in Phase 3. */
export const OWNER_EVENTS = [
  "booking_hold",
  "payment_submitted",
  "enquiry",
  "ota_booking",
  "ota_cancellation",
  "checkin_tomorrow",
  "message_draft",
  "message_failed",
  "documents_uploaded",
  "invoice_check_failed",
  "review_received",
  "guest_feedback",
] as const;
export type OwnerEvent = (typeof OWNER_EVENTS)[number];

/** How each alert is named in Settings, and whether it is on until the owner says otherwise. */
export const OWNER_EVENT_INFO: Record<OwnerEvent, { label: string; description: string; push: boolean; email: boolean }> = {
  booking_hold: { label: "New booking, payment pending", description: "A guest held dates on the website and has the QR to pay.", push: true, email: true },
  payment_submitted: { label: "Payment to confirm", description: "A guest says they have paid and sent the UPI reference.", push: true, email: true },
  enquiry: { label: "New enquiry", description: "An enquiry was added (you, or WhatsApp).", push: true, email: false },
  ota_booking: { label: "New OTA booking", description: "Booking.com, Airbnb or MakeMyTrip booked or closed nights.", push: true, email: false },
  ota_cancellation: { label: "Booking cancelled", description: "A booking was cancelled on any channel.", push: true, email: false },
  checkin_tomorrow: { label: "Check-in tomorrow", description: "Every evening at 6 pm, for guests arriving the next day.", push: true, email: false },
  message_draft: { label: "WhatsApp messages to send", description: "Guest messages are waiting for you to approve or send.", push: true, email: false },
  message_failed: { label: "WhatsApp message failed", description: "A message to a guest could not be delivered.", push: true, email: false },
  documents_uploaded: { label: "Guest ID uploaded", description: "A guest uploaded their ID before arrival.", push: true, email: false },
  invoice_check_failed: { label: "Invoices failing", description: "The hourly test of the invoice and confirmation PDFs failed, or recovered.", push: true, email: true },
  review_received: { label: "New Google review", description: "A new review, with a reply drafted for you.", push: true, email: true },
  guest_feedback: { label: "Complaints & suggestions book", description: "A guest wrote in the online complaints & suggestions book.", push: true, email: true },
};

export type StoredOwnerSettings = {
  alertEmail?: string | null;
  ownerWhatsapp?: string | null;
  caretakerWhatsapp?: string | null;
  /** How messages to the caretaker greet her, and how they are signed. */
  caretakerName?: string | null;
  ownerSignature?: string | null;
  /** Quiet hours for phone alerts (IST, "HH:MM"): alerts still arrive, without sound. */
  quietHours?: { start: string; end: string } | null;
  whatsappAutoreply?: boolean | null;
  whatsappMode?: WhatsappMode | null;
  pushEvents?: Partial<Record<OwnerEvent, boolean>>;
  emailEvents?: Partial<Record<OwnerEvent, boolean>>;
};

/** Built-in defaults the code used before this console existed. */
export const DEFAULT_OWNER_WHATSAPP = "+91 62903 99165";
export const DEFAULT_CARETAKER_WHATSAPP = "+91 78726 85558";
export const DEFAULT_OWNER_SIGNATURE = "Sourja Mukherjee";

export type Env = Record<string, string | undefined>;

export type SettingSource = "console" | "railway" | "default";
export type Resolved<T> = { value: T; source: SettingSource };

function fromEnv(env: Env, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

export function resolveAlertEmail(stored: StoredOwnerSettings, env: Env): Resolved<string | null> {
  if (stored.alertEmail) return { value: stored.alertEmail, source: "console" };
  const railway = fromEnv(env, "OWNER_ALERT_EMAIL");
  // null here means "the connected mailbox itself", decided by ownerEmail().
  return railway ? { value: railway, source: "railway" } : { value: null, source: "default" };
}

export function resolveOwnerWhatsapp(stored: StoredOwnerSettings, env: Env): Resolved<string> {
  if (stored.ownerWhatsapp) return { value: stored.ownerWhatsapp, source: "console" };
  const railway = fromEnv(env, "OWNER_WHATSAPP_NUMBER");
  return railway ? { value: railway, source: "railway" } : { value: DEFAULT_OWNER_WHATSAPP, source: "default" };
}

export function resolveCaretakerWhatsapp(stored: StoredOwnerSettings, env: Env): Resolved<string> {
  if (stored.caretakerWhatsapp) return { value: stored.caretakerWhatsapp, source: "console" };
  const railway = fromEnv(env, "CARETAKER_WHATSAPP");
  return railway ? { value: railway, source: "railway" } : { value: DEFAULT_CARETAKER_WHATSAPP, source: "default" };
}

/** A person's name as typed: trimmed, single-spaced, no control characters or WhatsApp formatting marks. */
export function cleanPersonName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f*_~`]/g, "").replace(/\s+/g, " ").trim();
  return name.length >= 2 && name.length <= 60 ? name : null;
}

export function resolveCaretakerName(stored: StoredOwnerSettings): Resolved<string | null> {
  return stored.caretakerName ? { value: stored.caretakerName, source: "console" } : { value: null, source: "default" };
}

export function resolveOwnerSignature(stored: StoredOwnerSettings): Resolved<string> {
  return stored.ownerSignature
    ? { value: stored.ownerSignature, source: "console" }
    : { value: DEFAULT_OWNER_SIGNATURE, source: "default" };
}

export function resolveAutoreply(stored: StoredOwnerSettings, env: Env): Resolved<boolean> {
  if (typeof stored.whatsappAutoreply === "boolean") return { value: stored.whatsappAutoreply, source: "console" };
  const railway = env["WHATSAPP_AUTOREPLY_ENABLED"];
  return railway !== undefined ? { value: railway === "true", source: "railway" } : { value: false, source: "default" };
}

/** What the WhatsApp Business API needs before the owner may switch to it. */
export type WhatsappReadiness = { ready: boolean; missing: string[]; warnings: string[] };

export function whatsappReadiness(env: Env): WhatsappReadiness {
  const missing: string[] = [];
  if (!fromEnv(env, "WHATSAPP_PHONE_NUMBER_ID")) missing.push("WHATSAPP_PHONE_NUMBER_ID is not set on Railway");
  if (!fromEnv(env, "WHATSAPP_ACCESS_TOKEN")) missing.push("WHATSAPP_ACCESS_TOKEN is not set on Railway");
  if (env["WHATSAPP_ENABLED"] !== "true") missing.push("WHATSAPP_ENABLED is not \"true\" on Railway");
  const warnings: string[] = [];
  if (!fromEnv(env, "WHATSAPP_CONFIRMATION_TEMPLATE")) {
    warnings.push("No approved confirmation template (WHATSAPP_CONFIRMATION_TEMPLATE): confirmation PDFs still go by email or your own WhatsApp");
  }
  return { ready: missing.length === 0, missing, warnings };
}

/**
 * Manual (the owner's own WhatsApp) or the Business API. An unset choice
 * keeps whatever the server did before this switch existed: the API when it
 * is switched on, otherwise manual. So deploying this never starts or stops a
 * message by itself.
 */
export function resolveWhatsappMode(stored: StoredOwnerSettings, env: Env): Resolved<WhatsappMode> {
  if (stored.whatsappMode === "manual" || stored.whatsappMode === "api") {
    return { value: stored.whatsappMode, source: "console" };
  }
  return { value: whatsappReadiness(env).ready ? "api" : "manual", source: "default" };
}

export function eventEnabled(map: Partial<Record<OwnerEvent, boolean>> | undefined, event: OwnerEvent, channel: "push" | "email" = "push"): boolean {
  const saved = map?.[event];
  return typeof saved === "boolean" ? saved : OWNER_EVENT_INFO[event][channel];
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Inside quiet hours right now (IST)? A window may run past midnight, e.g. 22:00 to 07:00. */
export function inQuietHours(quiet: StoredOwnerSettings["quietHours"], now: Date): boolean {
  if (!quiet || !HHMM.test(quiet.start) || !HHMM.test(quiet.end) || quiet.start === quiet.end) return false;
  const ist = new Date(now.getTime() + 330 * 60_000);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const toMin = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
  const start = toMin(quiet.start);
  const end = toMin(quiet.end);
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

function quietFrom(value: unknown): { start: string; end: string } | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const { start, end } = value as Record<string, unknown>;
  return typeof start === "string" && typeof end === "string" && HHMM.test(start) && HHMM.test(end) && start !== end ? { start, end } : undefined;
}

/* ------------------------------------------------------------------ *
 * Reading the stored document, and validating a change
 * ------------------------------------------------------------------ */

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

/** "+91 98300 12345", "9830012345", "919830012345" → "+91 98300 12345". Indian mobiles only. */
export function normaliseIndianMobile(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

function eventMap(value: unknown): Partial<Record<OwnerEvent, boolean>> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Partial<Record<OwnerEvent, boolean>> = {};
  for (const event of OWNER_EVENTS) {
    const v = (value as Record<string, unknown>)[event];
    if (typeof v === "boolean") out[event] = v;
  }
  return out;
}

/** Whatever is in the database, made safe. Bad or old values are dropped, never thrown. */
export function parseStoredSettings(raw: string | null | undefined): StoredOwnerSettings {
  if (!raw) return {};
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    data = parsed as Record<string, unknown>;
  } catch {
    return {};
  }
  const out: StoredOwnerSettings = {};
  if (typeof data.alertEmail === "string" && EMAIL.test(data.alertEmail)) out.alertEmail = data.alertEmail;
  if (typeof data.ownerWhatsapp === "string") out.ownerWhatsapp = normaliseIndianMobile(data.ownerWhatsapp);
  if (typeof data.caretakerWhatsapp === "string") out.caretakerWhatsapp = normaliseIndianMobile(data.caretakerWhatsapp);
  if (cleanPersonName(data.caretakerName)) out.caretakerName = cleanPersonName(data.caretakerName);
  if (cleanPersonName(data.ownerSignature)) out.ownerSignature = cleanPersonName(data.ownerSignature);
  const quiet = quietFrom(data.quietHours);
  if (quiet) out.quietHours = quiet;
  if (typeof data.whatsappAutoreply === "boolean") out.whatsappAutoreply = data.whatsappAutoreply;
  if (data.whatsappMode === "manual" || data.whatsappMode === "api") out.whatsappMode = data.whatsappMode;
  const push = eventMap(data.pushEvents);
  if (push) out.pushEvents = push;
  const email = eventMap(data.emailEvents);
  if (email) out.emailEvents = email;
  return out;
}

/** Fields whose change needs a fresh confirmation (fingerprint in the app, password on the web). */
export const SENSITIVE_FIELDS = ["alertEmail", "ownerWhatsapp", "caretakerWhatsapp", "whatsappMode"] as const;

export type SettingsPatchResult =
  | { ok: true; next: StoredOwnerSettings; changed: string[]; sensitive: boolean }
  | { ok: false; status: 400 | 409; error: string };

/**
 * Applies a PATCH from the console. `null` or "" clears a field back to its
 * Railway/default value. Unknown fields are refused rather than ignored, so a
 * typo in a client can never look like a save.
 */
export function applySettingsPatch(current: StoredOwnerSettings, body: unknown, env: Env): SettingsPatchResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Send the settings to change as a JSON object." };
  }
  const input = { ...(body as Record<string, unknown>) };
  delete input.confirmPassword;
  const allowed = new Set(["alertEmail", "ownerWhatsapp", "caretakerWhatsapp", "caretakerName", "ownerSignature", "quietHours", "whatsappAutoreply", "whatsappMode", "pushEvents", "emailEvents"]);
  const unknown = Object.keys(input).filter((k) => !allowed.has(k));
  if (unknown.length) return { ok: false, status: 400, error: `Unknown setting: ${unknown.join(", ")}.` };

  const next: StoredOwnerSettings = { ...current };
  const changed: string[] = [];
  const blank = (v: unknown) => v === null || (typeof v === "string" && v.trim() === "");

  if ("alertEmail" in input) {
    const v = input.alertEmail;
    if (blank(v)) next.alertEmail = null;
    else if (typeof v === "string" && EMAIL.test(v.trim()) && v.trim().length <= 254) next.alertEmail = v.trim().toLowerCase();
    else return { ok: false, status: 400, error: "That alert email address does not look right." };
  }
  for (const field of ["ownerWhatsapp", "caretakerWhatsapp"] as const) {
    if (!(field in input)) continue;
    const v = input[field];
    if (blank(v)) next[field] = null;
    else if (typeof v === "string" && normaliseIndianMobile(v)) next[field] = normaliseIndianMobile(v);
    else return { ok: false, status: 400, error: `${field === "ownerWhatsapp" ? "Your" : "The caretaker's"} WhatsApp number must be a 10-digit Indian mobile.` };
  }
  for (const field of ["caretakerName", "ownerSignature"] as const) {
    if (!(field in input)) continue;
    const v = input[field];
    if (blank(v)) next[field] = null;
    else if (cleanPersonName(v)) next[field] = cleanPersonName(v);
    else return { ok: false, status: 400, error: `${field === "caretakerName" ? "The caretaker's name" : "Your signature"} should be 2 to 60 letters.` };
  }
  if ("quietHours" in input) {
    const q = quietFrom(input.quietHours);
    if (q === undefined) return { ok: false, status: 400, error: "Quiet hours need a start and an end time, like 22:00 and 07:00." };
    next.quietHours = q;
  }
  if ("whatsappAutoreply" in input) {
    const v = input.whatsappAutoreply;
    if (v === null) next.whatsappAutoreply = null;
    else if (typeof v === "boolean") next.whatsappAutoreply = v;
    else return { ok: false, status: 400, error: "Auto-reply must be on or off." };
  }
  if ("whatsappMode" in input) {
    const v = input.whatsappMode;
    if (v !== "manual" && v !== "api") return { ok: false, status: 400, error: "WhatsApp mode must be manual or api." };
    if (v === "api") {
      const readiness = whatsappReadiness(env);
      if (!readiness.ready) {
        return { ok: false, status: 409, error: `The WhatsApp Business API is not ready yet: ${readiness.missing.join("; ")}.` };
      }
    }
    next.whatsappMode = v;
  }
  for (const field of ["pushEvents", "emailEvents"] as const) {
    if (!(field in input)) continue;
    const v = input[field];
    if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, status: 400, error: `${field} must be an object of on/off switches.` };
    const bad = Object.entries(v as Record<string, unknown>).find(([k, b]) => !(OWNER_EVENTS as readonly string[]).includes(k) || typeof b !== "boolean");
    if (bad) return { ok: false, status: 400, error: `Unknown or invalid alert switch: ${bad[0]}.` };
    next[field] = { ...(current[field] ?? {}), ...(v as Partial<Record<OwnerEvent, boolean>>) };
  }

  for (const key of Object.keys(input)) {
    const before = JSON.stringify((current as Record<string, unknown>)[key] ?? null);
    const after = JSON.stringify((next as Record<string, unknown>)[key] ?? null);
    if (before !== after) changed.push(key);
  }
  const sensitive = changed.some((k) => (SENSITIVE_FIELDS as readonly string[]).includes(k));
  return { ok: true, next, changed, sensitive };
}

/* ------------------------------------------------------------------ *
 * What the console shows
 * ------------------------------------------------------------------ */

/** Railway variables listed in Settings > System: whether set, never the value (UPI aside). */
export const RAILWAY_STATUS_VARS = [
  { name: "RAJ_KUTHIR_ADMIN_PASSWORD_HASH", group: "Security" },
  { name: "RAJ_KUTHIR_SESSION_SECRET", group: "Security" },
  { name: "RAJ_KUTHIR_UPI_ID", group: "Payments", showValue: true },
  { name: "RAJ_KUTHIR_UPI_NAME", group: "Payments", showValue: true },
  { name: "WHATSAPP_ENABLED", group: "WhatsApp", showValue: true },
  { name: "WHATSAPP_REQUIRE_APPROVAL", group: "WhatsApp", showValue: true },
  { name: "WHATSAPP_PHONE_NUMBER_ID", group: "WhatsApp" },
  { name: "WHATSAPP_ACCESS_TOKEN", group: "WhatsApp" },
  { name: "WHATSAPP_APP_SECRET", group: "WhatsApp" },
  { name: "WHATSAPP_VERIFY_TOKEN", group: "WhatsApp" },
  { name: "WHATSAPP_CONFIRMATION_TEMPLATE", group: "WhatsApp", showValue: true },
  { name: "WHATSAPP_INVOICE_TEMPLATE", group: "WhatsApp", showValue: true },
  { name: "WHATSAPP_REVIEW_TEMPLATES", group: "WhatsApp", showValue: true },
  { name: "MAIL_ENCRYPTION_KEY", group: "Mail" },
  { name: "BLUETICKS_API_KEY", group: "Caretaker alerts" },
  { name: "ANTHROPIC_API_KEY", group: "Review drafts" },
  { name: "RAJ_KUTHIR_CALENDAR_FEED_TOKEN", group: "Calendars" },
  { name: "GA4_MEASUREMENT_ID", group: "Analytics", showValue: true },
] as const;

export function railwayStatus(env: Env) {
  return RAILWAY_STATUS_VARS.map((v) => {
    const raw = env[v.name]?.trim();
    return {
      name: v.name,
      group: v.group,
      set: Boolean(raw),
      value: "showValue" in v && v.showValue && raw ? raw : null,
    };
  });
}

/** The whole Settings view: effective values, where each came from, and readiness. */
export function settingsView(stored: StoredOwnerSettings, env: Env) {
  const events = (map: StoredOwnerSettings["pushEvents"], channel: "push" | "email") =>
    Object.fromEntries(OWNER_EVENTS.map((e) => [e, eventEnabled(map, e, channel)])) as Record<OwnerEvent, boolean>;
  return {
    contacts: {
      alertEmail: resolveAlertEmail(stored, env),
      ownerWhatsapp: resolveOwnerWhatsapp(stored, env),
      caretakerWhatsapp: resolveCaretakerWhatsapp(stored, env),
      caretakerName: resolveCaretakerName(stored),
      ownerSignature: resolveOwnerSignature(stored),
    },
    whatsapp: {
      mode: resolveWhatsappMode(stored, env),
      autoreply: resolveAutoreply(stored, env),
      readiness: whatsappReadiness(env),
      requireApproval: env["WHATSAPP_REQUIRE_APPROVAL"] !== "false",
    },
    alerts: {
      push: events(stored.pushEvents, "push"),
      email: events(stored.emailEvents, "email"),
      quietHours: stored.quietHours ?? null,
      events: OWNER_EVENTS.map((event) => ({ event, label: OWNER_EVENT_INFO[event].label, description: OWNER_EVENT_INFO[event].description })),
    },
    railway: railwayStatus(env),
    sensitiveFields: SENSITIVE_FIELDS,
  };
}
