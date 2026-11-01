/**
 * The owner console's API client, shared by the web console and the phone app.
 *
 * Transport only differs in two ways, both set once at start-up:
 *  - the web console calls relative /api paths with its HttpOnly cookie
 *    (the default: nothing to configure);
 *  - the phone app calls https://rajkuthirhomestays.casa with
 *    `Authorization: Bearer <token>`, the token read from secure storage.
 *
 * Plain async functions, no React: each client wraps them in its own hooks.
 */

export class AdminApiError extends Error {
  readonly status: number;
  /** True when the server wants the password (web) or fingerprint (app) again. */
  readonly needsConfirmation: boolean;

  constructor(message: string, status: number, needsConfirmation = false) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.needsConfirmation = needsConfirmation;
  }
}

type TokenGetter = () => Promise<string | null> | string | null;

let baseUrl = '';
let getToken: TokenGetter | null = null;
let onUnauthorized: (() => void) | null = null;

/** Phone app: `configureAdminClient({ baseUrl: 'https://…', getToken })`. The web console never calls this. */
export function configureAdminClient(options: { baseUrl?: string; getToken?: TokenGetter | null; onUnauthorized?: (() => void) | null }): void {
  if (options.baseUrl !== undefined) baseUrl = options.baseUrl.replace(/\/+$/, '');
  if (options.getToken !== undefined) getToken = options.getToken;
  if (options.onUnauthorized !== undefined) onUnauthorized = options.onUnauthorized;
}

export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type') && !(init?.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const token = getToken ? await getToken() : null;
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${baseUrl}${path}`, {
    credentials: token ? 'omit' : 'include',
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown; needsConfirmation?: unknown };
    if (response.status === 401) onUnauthorized?.();
    throw new AdminApiError(
      typeof body.error === 'string' ? body.error : `Request failed (${response.status})`,
      response.status,
      body.needsConfirmation === true,
    );
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

/* ------------------------------------------------------------- session */

export type AdminSession = { signedIn: boolean; configured: boolean; via: 'web' | 'app' | null };
export const getSession = () => adminFetch<AdminSession>('/api/admin/me');

/* -------------------------------------------------------- phone sign-in */

export type OwnerDevice = {
  id: string;
  name: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string;
  signedOut: boolean;
  pushEnabled: boolean;
  thisDevice: boolean;
};

export const appLogin = (input: { password: string; deviceName: string; platform: 'android' | 'ios' }) =>
  adminFetch<{ token: string; device: OwnerDevice }>('/api/admin/app/login', json('POST', input));
export const appLogout = () => adminFetch<void>('/api/admin/app/logout', json('POST'));
export const setPushToken = (pushToken: string | null) => adminFetch<void>('/api/admin/app/push-token', json('PUT', { pushToken }));
export const listDevices = () => adminFetch<{ devices: OwnerDevice[] }>('/api/admin/devices');
export const revokeDevice = (id: string, confirmPassword?: string) =>
  adminFetch<void>(`/api/admin/devices/${encodeURIComponent(id)}`, json('DELETE', confirmPassword ? { confirmPassword } : {}));

/* ------------------------------------------------------------- settings */

export const OWNER_EVENTS = [
  'booking_hold',
  'payment_submitted',
  'enquiry',
  'ota_booking',
  'ota_cancellation',
  'checkin_tomorrow',
  'message_draft',
  'message_failed',
  'documents_uploaded',
  'invoice_check_failed',
  'review_received',
] as const;
export type OwnerEvent = (typeof OWNER_EVENTS)[number];
export type SettingSource = 'console' | 'railway' | 'default';
export type Resolved<T> = { value: T; source: SettingSource };
export type WhatsappMode = 'manual' | 'api';

export type SettingsView = {
  contacts: {
    alertEmail: Resolved<string | null>;
    ownerWhatsapp: Resolved<string>;
    caretakerWhatsapp: Resolved<string>;
    caretakerName: Resolved<string | null>;
    ownerSignature: Resolved<string>;
  };
  whatsapp: {
    mode: Resolved<WhatsappMode>;
    autoreply: Resolved<boolean>;
    readiness: { ready: boolean; missing: string[]; warnings: string[] };
    requireApproval: boolean;
  };
  alerts: {
    push: Record<OwnerEvent, boolean>;
    email: Record<OwnerEvent, boolean>;
    /** IST "HH:MM"; alerts arrive without sound inside it. Null: always with sound. */
    quietHours: { start: string; end: string } | null;
    /** Labels and descriptions for the Settings list, in display order. */
    events: { event: OwnerEvent; label: string; description: string }[];
  };
  railway: { name: string; group: string; set: boolean; value: string | null }[];
  sensitiveFields: readonly string[];
};

export type SettingsPatch = Partial<{
  alertEmail: string | null;
  ownerWhatsapp: string | null;
  caretakerWhatsapp: string | null;
  caretakerName: string | null;
  ownerSignature: string | null;
  quietHours: { start: string; end: string } | null;
  whatsappAutoreply: boolean | null;
  whatsappMode: WhatsappMode;
  pushEvents: Partial<Record<OwnerEvent, boolean>>;
  emailEvents: Partial<Record<OwnerEvent, boolean>>;
}> & { confirmPassword?: string };

export const getSettings = () => adminFetch<SettingsView>('/api/admin/settings');
export const patchSettings = (patch: SettingsPatch) =>
  adminFetch<{ changed: string[]; settings: SettingsView }>('/api/admin/settings', json('PATCH', patch));

export type AuditEntry = { at: string; via: 'web' | 'app'; action: string; detail: Record<string, unknown> };
export const getAudit = () => adminFetch<{ entries: AuditEntry[] }>('/api/admin/audit');

/* --------------------------------------------------- WhatsApp messages */

export type OutboxMessage = {
  id: string;
  bookingId: string | null;
  kind: 'booking_confirmed' | 'checkin_reminder' | 'checkout_today' | 'review_request';
  status: 'draft' | 'pending' | 'sent' | 'failed' | 'cancelled';
  toPhone: string;
  preview: string;
  sendAfter: string;
  error: string | null;
  providerMessageId: string | null;
  sentAt: string | null;
};

export const getOutbox = () =>
  adminFetch<{ configured: boolean; enabled: boolean; mode: WhatsappMode; messages: OutboxMessage[] }>('/api/notifications');
export const approveMessage = (id: string) => adminFetch<OutboxMessage>(`/api/notifications/${id}/approve`, json('POST'));
export const cancelMessage = (id: string) => adminFetch<OutboxMessage>(`/api/notifications/${id}/cancel`, json('POST'));
export const markMessageSentManually = (id: string) => adminFetch<OutboxMessage>(`/api/notifications/${id}/sent-manually`, json('POST'));

/** A wa.me link that opens the owner's own WhatsApp on the guest's chat with the text filled in. */
export function manualWhatsappLink(toPhone: string, text: string): string {
  return `https://wa.me/${toPhone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

/* -------------------------------------------------- caretaker console */

export type CaretakerMessageKind = 'salary_credited' | 'bonus_credited' | 'day_off' | 'notice';
export type CaretakerFieldSpec = {
  key: string;
  label: string;
  type: 'month' | 'date' | 'choice' | 'text' | 'longtext';
  required: boolean;
  options?: readonly string[];
  max?: number;
  hint?: string;
};
export type CaretakerTemplate = { kind: CaretakerMessageKind; title: string; description: string; fields: CaretakerFieldSpec[] };
export type CaretakerMessage = {
  id: string;
  kind: CaretakerMessageKind;
  fields: Record<string, string>;
  body: string;
  toPhone: string;
  via: 'web' | 'app';
  createdAt: string;
  sentAt: string | null;
};
export type CaretakerConsole = {
  caretaker: { name: string | null; phone: string };
  signature: string;
  templates: CaretakerTemplate[];
  /** Today in India, YYYY-MM-DD: the default "paid on" date. */
  today: string;
  history: CaretakerMessage[];
};
export type CaretakerDraft = { kind: CaretakerMessageKind; fields: Record<string, string> };

export const getCaretakerConsole = () => adminFetch<CaretakerConsole>('/api/admin/caretaker/messages');
export const previewCaretakerMessage = (draft: CaretakerDraft) =>
  adminFetch<{ body: string }>('/api/admin/caretaker/messages/preview', json('POST', draft));
/** Saves it to the history and returns the wa.me link that opens your WhatsApp on her chat with it typed. */
export const createCaretakerMessage = (draft: CaretakerDraft) =>
  adminFetch<{ message: CaretakerMessage; whatsappUrl: string }>('/api/admin/caretaker/messages', json('POST', draft));
export const markCaretakerMessageSent = (id: string) =>
  adminFetch<CaretakerMessage>(`/api/admin/caretaker/messages/${encodeURIComponent(id)}/sent`, json('POST'));

/* --------------------------------------- bookings: inform the caretaker */

export type BookingAlertKind = 'new_booking' | 'checkin_eve' | 'checkout_eve' | 'cancelled';
export type CaretakerBookingMessage = {
  kind: BookingAlertKind;
  label: string;
  /** The WhatsApp text. Never carries an amount. */
  text: string;
  whatsappUrl: string | null;
  done: { status: 'sent' | 'skipped'; at: string | null; how: 'manual' | 'automatic' } | null;
};
export type CaretakerBookingCard = {
  bookingId: string;
  guestName: string | null;
  checkIn: string;
  checkOut: string;
  status: 'confirmed' | 'cancelled';
  source: string;
  when: string;
  suggested: BookingAlertKind | null;
  messages: CaretakerBookingMessage[];
};

/** Every booking that has not ended, with the messages you can send the caretaker about it. */
export const getCaretakerBookings = () => adminFetch<{ caretaker: string | null; cards: CaretakerBookingCard[] }>('/api/admin/caretaker/bookings');
/** Records that you sent (or chose to skip) one of those messages. */
export const markCaretakerBooking = (bookingId: string, kind: BookingAlertKind, outcome: 'sent' | 'skipped' = 'sent') =>
  adminFetch<{ ok: true; outcome: 'sent' | 'skipped' }>(
    `/api/admin/caretaker/${encodeURIComponent(bookingId)}/${encodeURIComponent(kind)}`,
    json('POST', { outcome }),
  );

/* ----------------------------------------------------- month calendar */

export type CalendarDayStatus = 'past' | 'free' | 'booked' | 'blocked' | 'held';
export type CalendarDay = {
  date: string;
  weekday: number;
  status: CalendarDayStatus;
  source: string | null;
  label: string | null;
  checkIn: boolean;
  checkOut: boolean;
  pricePaise: number | null;
  peak: string | null;
  minNights: number | null;
};
export type CalendarMonth = {
  month: string;
  previous: string;
  next: string;
  today: string;
  days: CalendarDay[];
  summary: { bookedNights: number; heldNights: number; blockedNights: number; freeNights: number; occupancyAheadPercent: number | null };
};
/** month is YYYY-MM; omit it for this month. */
export const getCalendarMonth = (month?: string) =>
  adminFetch<CalendarMonth>(`/api/admin/calendar/month${month ? `?month=${encodeURIComponent(month)}` : ''}`);

/* --------------------------------------------------------------- alerts */

export type OwnerAlert = {
  id: string;
  event: OwnerEvent | 'test' | string;
  title: string;
  body: string;
  /** Console path to open: map it to an app screen (e.g. /admin/guests#payments → Payments). */
  href: string;
  createdAt: string;
  read: boolean;
  pushed: boolean;
  emailed: boolean;
};

export const getAlerts = (limit = 50) => adminFetch<{ alerts: OwnerAlert[]; unread: number }>(`/api/admin/alerts?limit=${limit}`);
/** Omit ids to mark everything read. */
export const markAlertsRead = (ids?: string[]) => adminFetch<void>('/api/admin/alerts/read', json('POST', ids ? { ids } : {}));
/** From the app: a test push to this phone. From the web: to every signed-in phone. */
export const sendTestAlert = () => adminFetch<{ sent: number; quiet: boolean; signedOutPhones: number }>('/api/admin/alerts/test', json('POST'));
