/**
 * Everything the app asks the server, in one place. Transport, errors and the
 * typed settings / phone / WhatsApp calls come from the web console's shared
 * client (lib/admin-client); the rest are the console's existing endpoints,
 * typed here with the fields the app actually reads.
 */
import {
  adminFetch,
  configureAdminClient,
} from '../../../lib/admin-client/src';

export * from '../../../lib/admin-client/src';

export const SITE = 'https://rajkuthirhomestays.casa';

export function setupApi(getToken: () => Promise<string | null>, onUnauthorized: () => void) {
  configureAdminClient({ baseUrl: SITE, getToken, onUnauthorized });
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

/* --------------------------------------------------------- Book & Pay */

export type PaymentRow = {
  id: string;
  reference: string;
  status: 'awaiting_payment' | 'submitted' | 'confirmed' | 'rejected' | 'expired';
  guestName: string;
  guestPhone: string;
  checkIn: string | null;
  checkOut: string | null;
  guests: number;
  pets: number;
  totalPaise: number;
  advancePaise: number;
  utr: string | null;
  utrSubmittedAt: string | null;
  hasScreenshot: boolean;
  holdExpiresAt: string;
  overdue: boolean;
  createdAt: string;
};

export const getPayments = () => adminFetch<{ payments: PaymentRow[]; migrationNeeded?: boolean }>('/api/admin/book-pay');

export type ConfirmResult = {
  booking: { id: string; reference: string };
  emailed: boolean;
  whatsappUrl: string | null;
  preview: string;
};

export const confirmPayment = (id: string, force = false) =>
  adminFetch<ConfirmResult>(`/api/admin/book-pay/${id}/confirm`, json('POST', force ? { force: true } : {}));
export const rejectPayment = (id: string, reason: string) =>
  adminFetch<unknown>(`/api/admin/book-pay/${id}/reject`, json('POST', { reason }));
export const screenshotUrl = (id: string) => `${SITE}/api/admin/book-pay/${id}/screenshot`;

/* ------------------------------------------------------------ activity */

export type ActivityItem = { id: string; kind: string; at: string; title: string; detail: string; href: string };
export const getActivity = () => adminFetch<{ since: string; items: ActivityItem[] }>('/api/admin/activity');
export const markActivitySeen = (upTo: string) => adminFetch<void>('/api/admin/activity/seen', json('POST', { upTo }));

/* ----------------------------------------------------------- enquiries */

export type EnquiryStatus = 'new' | 'contacted' | 'converted' | 'closed';

export type Enquiry = {
  id: string;
  name: string;
  phone: string;
  checkIn: string | null;
  checkOut: string | null;
  adults: number | null;
  children: number | null;
  pets: number | null;
  requests: string | null;
  status: EnquiryStatus;
  createdAt: string;
  quoteSentAt: string | null;
  convertedBookingId: string | null;
  quote: { ok: true; totalPaise: number; advancePaise: number; nights: number } | { ok: false; reason: string };
  datesTaken?: { startDate: string; endDate: string; label: string } | null;
};

export const getEnquiries = () => adminFetch<{ enquiries: Enquiry[] }>('/api/enquiries');
export const setEnquiryStatus = (id: string, status: EnquiryStatus) =>
  adminFetch<unknown>(`/api/enquiries/${id}`, json('PATCH', { status }));

/* ------------------------------------------------------------ calendar */

export type CalendarEvent = {
  id: string;
  source: 'manual' | 'direct' | 'bookingCom' | 'airbnb' | 'makeMyTrip';
  startDate: string;
  endDate: string;
  title: string | null;
  note: string | null;
  editable: boolean;
};

export const getCalendar = () => adminFetch<{ events: CalendarEvent[] }>('/api/calendar/events');
export const blockDates = (startDate: string, endDate: string, title?: string) =>
  adminFetch<CalendarEvent>('/api/calendar/block', json('POST', { startDate, endDate, ...(title ? { title } : {}) }));
export const unblockDates = (id: string) => adminFetch<void>(`/api/calendar/block/${id}`, json('DELETE'));
export const syncCalendars = () => adminFetch<unknown>('/api/calendar/sync', json('POST'));
