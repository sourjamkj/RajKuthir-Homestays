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

/** Whether the quoted dates are still held; worked out by the server. */
export type HoldState =
  | { state: 'none' }
  | { state: 'held'; expiresAt: string; hoursLeft: number }
  | { state: 'released'; expiresAt: string }
  | { state: 'paid'; paidAt: string };

export type Enquiry = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  checkIn: string | null;
  checkOut: string | null;
  adults: number | null;
  children: number | null;
  pets: number | null;
  requests: string | null;
  status: EnquiryStatus;
  createdAt: string;
  quoteSentAt: string | null;
  quotedTotalPaise?: number | null;
  quotedAdvancePaise?: number | null;
  advancePaidAt?: string | null;
  hold?: HoldState;
  convertedBookingId: string | null;
  quote:
    | {
        ok: true;
        totalPaise: number;
        advancePaise: number;
        balancePaise?: number;
        nights: number;
        guests?: number;
        /** The owner's agreed price, not the rate card. */
        agreed?: boolean;
        priceNote?: string | null;
      }
    | { ok: false; reason: string };
  /** The owner's extra details. */
  childrenAges?: string | null;
  ownerNote?: string | null;
  agreedTotalPaise?: number | null;
  agreedAdvancePaise?: number | null;
  priceNote?: string | null;
  datesTaken?: { startDate: string; endDate: string; label: string } | null;
  /** Has stayed before (a past booking, or tagged "Repeat guest"). */
  returningGuest?: boolean;
  /** The WhatsApp reply, written by the server: the price when it is known, a welcome back for a returning guest. */
  followUpText?: string;
};

type DatesTaken = { startDate: string; endDate: string; label: string } | null;

export const getEnquiries = () => adminFetch<{ enquiries: Enquiry[]; quotingReady?: boolean }>('/api/enquiries');
export const setEnquiryStatus = (id: string, status: EnquiryStatus) =>
  adminFetch<unknown>(`/api/enquiries/${id}`, json('PATCH', { status }));
/**
 * The enquiry fields the owner fills in or corrects. Strings as typed:
 * empty clears an optional field; rupees, not paise, for the agreed price.
 */
export type EnquiryDetails = {
  name: string;
  phone: string;
  checkIn: string;
  checkOut: string;
  adults: string;
  children: string;
  childrenAges: string;
  pets: string;
  requests: string;
  ownerNote: string;
  agreedTotalRupees: string;
  agreedAdvanceRupees: string;
  priceNote: string;
};
/** A lead taken by phone or in person: name and phone are enough, the rest helps the reply. */
export const createEnquiry = (input: EnquiryDetails) =>
  adminFetch<{ id: string; datesTaken?: DatesTaken }>(
    '/api/admin/enquiries',
    json('POST', { ...input, checkIn: input.checkIn || undefined, checkOut: input.checkOut || undefined }),
  );
export const updateEnquiry = (id: string, input: EnquiryDetails) => adminFetch<Enquiry>(`/api/enquiries/${id}`, json('PATCH', input));
export const deleteEnquiry = (id: string) => adminFetch<void>(`/api/enquiries/${id}`, json('DELETE'));
/** Records the quote and holds the dates; manual WhatsApp returns the link to open. */
export const sendQuote = (id: string) =>
  adminFetch<{ delivery: 'api' | 'manual_whatsapp'; whatsappUrl: string | null }>(`/api/enquiries/${id}/quote`, json('POST', {}));
export const withdrawQuote = (id: string) => adminFetch<void>(`/api/enquiries/${id}/quote`, json('DELETE'));
export const setAdvanceReceived = (id: string, paid: boolean) =>
  adminFetch<unknown>(`/api/enquiries/${id}/advance-received`, json('POST', { paid }));
export const convertEnquiry = (id: string) =>
  adminFetch<{ booking: { reference: string | null; status: string } }>(`/api/enquiries/${id}/convert`, json('POST', {}));
export type BookWithDetails = {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  pets: number;
  totalRupees: number;
  advanceRupees: number;
  confirmWithoutAdvance: boolean;
};
export const bookEnquiry = (id: string, input: BookWithDetails) =>
  adminFetch<{ booking: { reference: string | null } }>(`/api/enquiries/${id}/book`, json('POST', input));

/* ------------------------------------------------- guests and bookings */

export type BookingSource = 'direct' | 'manual' | 'bookingCom' | 'airbnb' | 'makeMyTrip' | (string & {});

export const SOURCE_LABELS: Record<string, string> = {
  manual: 'Offline / walk-in',
  direct: 'Direct booking',
  bookingCom: 'Booking.com',
  airbnb: 'Airbnb',
  makeMyTrip: 'MakeMyTrip',
};

export type GuestStay = {
  bookingId: string;
  reference: string | null;
  source: BookingSource;
  createdAt: string;
  guestName: string | null;
  guestPhone: string | null;
  checkIn: string;
  checkOut: string;
  guests: number | null;
  pets: number | null;
  status: 'pending' | 'confirmed' | 'cancelled';
  grossPaise: number | null;
  receivedPaise: number | null;
  onboardingStatus: 'pending' | 'submitted' | 'verified' | 'expired' | 'blocked' | null;
  verificationDeadline: string | null;
  documents: { pending: number; submitted: number; verified: number; rejected: number };
};

/** The management view of a stay: built by the server with no money in it. */
export type ManagementGuestVerification = {
  guestName: string | null;
  guestPhone: string | null;
  checkIn: string;
  checkOut: string;
  documents: { count: number; submitted: number; verified: number; rejected: number };
  readiness: 'ready' | 'documents_submitted' | 'awaiting_documents' | 'deadline_passed' | 'blocked';
  verificationDeadline: string | null;
};

export type GuestDocument = {
  id: string;
  documentType: string;
  documentNumber: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  status: 'pending' | 'submitted' | 'verified' | 'rejected';
  rejectionReason: string | null;
  uploadedAt: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
};

export type ArrivalInfo = {
  wifiSsid: string;
  wifiPassword: string;
  arrival: string;
  contacts: { label: string; name: string; phone: string }[];
};

export const getGuestStays = () => adminFetch<{ stays: GuestStay[] }>('/api/admin/guest-stays');
/** Mints the guest's pre-arrival link (and moves a passed deadline). */
export const createOnboarding = (bookingId: string) =>
  adminFetch<{ url: string; verificationDeadline: string }>(`/api/admin/guest-stays/${bookingId}/onboarding`, json('POST', {}));
export const getArrivalInfo = () => adminFetch<ArrivalInfo>('/api/admin/guest-info');
export const getManagementAccess = (bookingId: string) =>
  adminFetch<{ url: string; expiresAt: string; management: ManagementGuestVerification }>(
    `/api/admin/guest-stays/${bookingId}/management-access`,
    json('POST', {}),
  );
export const getStayDocuments = (bookingId: string) =>
  adminFetch<{ documents: GuestDocument[] }>(`/api/admin/guest-stays/${bookingId}/documents`);
export const rejectDocuments = (bookingId: string, reason: string) =>
  adminFetch<{ rejected: number }>(`/api/admin/guest-stays/${bookingId}/reject`, json('POST', { reason }));
export const verifyDocuments = (bookingId: string, verified: boolean) =>
  adminFetch<unknown>(`/api/admin/guest-stays/${bookingId}/verify`, json('POST', { verified }));
export const documentFilePath = (bookingId: string, documentId: string) =>
  `/api/admin/guest-stays/${bookingId}/documents/${documentId}/file`;
/** Guest details on a booking. An amount left out is left as it was. */
export const updateBooking = (
  bookingId: string,
  details: { guestName: string; guestPhone: string; guests: string; pets: string; checkIn: string; checkOut: string; gross?: string; received?: string },
) => adminFetch<unknown>(`/api/bookings/${bookingId}`, json('PATCH', details));

export type Contact = {
  phone: string;
  name: string | null;
  email: string | null;
  stays: number;
  enquiryCount: number;
  lastStay: string | null;
  lastEnquiry: string | null;
  totalSpentPaise: number;
  marketingOptOut: boolean;
  note: string | null;
  tags: string | null;
};
export const getContacts = () => adminFetch<{ contacts: Contact[] }>('/api/contacts');
export const setMarketingOptOut = (phone: string, optOut: boolean) =>
  adminFetch<unknown>(`/api/contacts/${phone}`, json('PATCH', { marketingOptOut: optOut }));

/* ------------------------------------------------------------ invoices */

export type InvoiceStatus = {
  number: string | null;
  emailedAt: string | null;
  emailTo: string | null;
  email: string | null;
  autoStatus: string;
  needsAction: boolean;
  whatsappReady: boolean;
  canInvoice: boolean;
  problem: string | null;
  otaDocuments: Array<{ id: string; kind: 'voucher' | 'cancellation' | 'statement' | 'other'; filename: string; createdAt: string }>;
};
export const getInvoiceStatuses = (bookingIds: string[]) =>
  adminFetch<{ invoices: Record<string, InvoiceStatus> }>(`/api/admin/invoices?ids=${bookingIds.join(',')}`);
export const emailInvoice = (bookingId: string, to?: string) =>
  adminFetch<{ to: string }>(`/api/admin/bookings/${bookingId}/invoice/email`, json('POST', to ? { to } : {}));
export const whatsappInvoice = (bookingId: string) =>
  adminFetch<{ sent: boolean; to?: string; whatsappUrl?: string | null; text?: string }>(
    `/api/admin/bookings/${bookingId}/invoice/whatsapp`,
    json('POST', {}),
  );
export const markPaidInFull = (bookingId: string) =>
  adminFetch<{ emailed: string | null; note?: string }>(`/api/admin/bookings/${bookingId}/paid-in-full`, json('POST', {}));

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

/* ------------------------------------------------- Claude connector */

export type ConnectorStatus = { url: string; connected: boolean; since: string | null; lastUsed: string | null };
export const getConnectorStatus = () => adminFetch<ConnectorStatus>('/api/admin/claude-connector');
export const disconnectConnector = () => adminFetch<{ disconnected: boolean; revoked: number }>('/api/admin/claude-connector/disconnect', json('POST', {}));
