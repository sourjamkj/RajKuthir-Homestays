import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
  BellOff,
  CalendarPlus,
  Check,
  ExternalLink,
  FileText,
  Inbox,
  Loader2,
  MessageCircle,
  Phone,
  Send,
  Timer,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import { adminFetch, useAdminSession, useLogout } from '@/lib/admin-api';
import { formatRupees } from '@/lib/ledger-api';
import { CONFIG } from '@/lib/site';
import { AdminHeader } from '@/components/AdminHeader';

const ENQUIRIES_KEY = ['/api/enquiries'];
const CONTACTS_KEY = ['/api/contacts'];
const GUEST_STAYS_KEY = ['/api/admin/guest-stays'];

/**
 * Where the management handoff message is addressed.
 *
 * This was the literal '916290399165' marked "temporary, replace before
 * production" — which is the host's own number from CONFIG, typed a second
 * time. Reading it from site.ts means changing the number in one place
 * changes it everywhere, and nothing here is labelled a test any more.
 */
const MANAGEMENT_WHATSAPP = CONFIG.hostPhone.replace(/\D/g, '');

/**
 * The house's published hours. The same two figures are in the house rules
 * page, in the LodgingBusiness structured data, and in
 * guest-onboarding-repo.ts, which anchors the 48-hour verification deadline to
 * check-in. The confirmation message below used to say 11:00 AM / 10:00 AM,
 * an hour early on both counts.
 */
const CHECK_IN_TIME = '12:00 PM';
const CHECK_OUT_TIME = '11:00 AM';

type EnquiryStatus = 'new' | 'contacted' | 'converted' | 'closed';

/**
 * What this enquiry would be quoted at today, or why it cannot be priced.
 * Calculated server-side from the live rate plan so the owner sees the number
 * before deciding to send it.
 */
type QuoteResult =
  | {
      ok: true;
      checkIn: string;
      checkOut: string;
      nights: number;
      guests: number;
      totalPaise: number;
      advancePaise: number;
      balancePaise: number;
    }
  | { ok: false; reason: string };

/**
 * Whether these dates are still being held. Derived server-side from the
 * quote and payment timestamps, so it is never stale and never needs
 * clearing — a hold that nobody attends to simply stops being one.
 */
type HoldState =
  | { state: 'none' }
  | { state: 'held'; expiresAt: string; hoursLeft: number }
  | { state: 'released'; expiresAt: string }
  | { state: 'paid'; paidAt: string };

type Enquiry = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  checkIn: string | null;
  checkOut: string | null;
  adults: number | null;
  children: number | null;
  pets: number | null;
  requests: string | null;
  status: EnquiryStatus;
  createdAt: string;
  quote: QuoteResult;
  /** Set once a quote has actually reached the guest, never before. */
  quotedTotalPaise: number | null;
  quotedAdvancePaise: number | null;
  quoteSentAt: string | null;
  advancePaidAt: string | null;
  hold: HoldState;
  /** The booking this enquiry became, once it has become one. */
  convertedBookingId: string | null;
};


/**
 * The client mirror of the server's ManagementGuestVerificationDTO.
 *
 * Deliberately has NO financial fields. buildManagementMessage below takes
 * only this type, so a rupee figure cannot be interpolated into a management
 * message without first adding a money field to this interface and to the
 * server whitelist that fills it — which is exactly the friction that is
 * wanted. A test asserts both.
 */
type ManagementGuestVerification = {
  guestName: string | null;
  guestPhone: string | null;
  checkIn: string;
  checkOut: string;
  documents: { count: number; submitted: number; verified: number; rejected: number };
  readiness: 'ready' | 'documents_submitted' | 'awaiting_documents' | 'deadline_passed' | 'blocked';
  verificationDeadline: string | null;
};

/**
 * One filed identity document, as the owner sees it.
 *
 * `verifiedBy` matters: 'auto:on-upload' means the document was accepted
 * because the upload completed, not because anybody looked at it. The panel
 * says so, because "Verified" meaning two different things without saying
 * which is how a caretaker ends up trusting a blank photograph.
 */
type GuestDocument = {
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

const VERIFIED_ON_UPLOAD = 'auto:on-upload';

type GuestStay = {
  bookingId: string;
  reference: string | null;
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

type Contact = {
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

const STATUS_STYLE: Record<EnquiryStatus, string> = {
  new: 'bg-primary/10 text-primary border-primary/30',
  contacted: 'bg-[#d8a24a]/15 text-[#8a6320] border-[#d8a24a]/40',
  converted: 'bg-[#7A8065]/15 text-[#4b5340] border-[#7A8065]/40',
  closed: 'bg-muted text-muted-foreground border-border',
};

const STATUSES: EnquiryStatus[] = ['new', 'contacted', 'converted', 'closed'];

const waLink = (phone: string, name: string | null) =>
  `https://wa.me/${phone.replace(/\D/g, '').replace(/^0+/, '')}?text=${encodeURIComponent(
    `Hello ${name ?? ''}, this is Raj Kuthir Homestays – Sobuj Potro.`.replace(
      /\s+/g,
      ' ',
    ),
  )}`;

export default function AdminGuests() {
  const [, navigate] = useLocation();
  const session = useAdminSession();
  const logout = useLogout();
  const queryClient = useQueryClient();
  const signedIn = session.data?.signedIn === true;

  useEffect(() => {
    if (session.isSuccess && !signedIn) {
      navigate('/admin/login', { replace: true });
    }
  }, [session.isSuccess, signedIn, navigate]);

  const enquiries = useQuery({
    queryKey: ENQUIRIES_KEY,
    queryFn: () =>
      adminFetch<{ enquiries: Enquiry[]; quotingReady: boolean }>(
        '/api/enquiries',
      ),
    enabled: signedIn,
    retry: false,
  });

  const contacts = useQuery({
    queryKey: CONTACTS_KEY,
    queryFn: () => adminFetch<{ contacts: Contact[] }>('/api/contacts'),
    enabled: signedIn,
    retry: false,
  });

  const guestStays = useQuery({
    queryKey: GUEST_STAYS_KEY,
    queryFn: () => adminFetch<{ stays: GuestStay[] }>('/api/admin/guest-stays'),
    enabled: signedIn,
    retry: false,
  });

  const createOnboarding = useMutation({
    mutationFn: async (stay: GuestStay) => {
      const result = await adminFetch<{ url: string; verificationDeadline: string }>(
        `/api/admin/guest-stays/${stay.bookingId}/onboarding`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      const message = buildGuestWhatsAppMessage(stay, result.url);
      if (!stay.guestPhone) throw new Error('This booking has no guest mobile number.');
      window.open(
        `https://wa.me/${stay.guestPhone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`,
        '_blank',
        'noopener,noreferrer',
      );
      return result;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: GUEST_STAYS_KEY }),
  });

  /**
   * Asks the server for a management access link AND the management view of
   * the booking.
   *
   * The `management` half is the important part: it is a
   * ManagementGuestVerificationDTO built server-side from whitelisted columns,
   * so the financial fields on `stay` are not merely unused here, they are
   * never sent on this path. The message below is composed from the DTO only
   * — `stay` is used for nothing but its bookingId.
   */
  const prepareManagement = useMutation({
    mutationFn: async (stay: GuestStay) => {
      const result = await adminFetch<{
        url: string;
        expiresAt: string;
        management: ManagementGuestVerification;
      }>(
        `/api/admin/guest-stays/${stay.bookingId}/management-access`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      return result;
    },
  });

  const managementSubject = (dto: ManagementGuestVerification) =>
    `Sobuj Potro — Guest Arrival / Verification — ${dto.guestName ?? 'Guest'}`;

  const openManagementWhatsApp = async (stay: GuestStay) => {
    const result = await prepareManagement.mutateAsync(stay);
    const message = buildManagementMessage(result.management, result.url);
    window.open(`https://wa.me/${MANAGEMENT_WHATSAPP}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  };

  const openManagementEmail = async (stay: GuestStay) => {
    const result = await prepareManagement.mutateAsync(stay);
    const message = buildManagementMessage(result.management, result.url);
    // No management address is committed: the mail client lets the owner pick
    // the management recipient while the subject/body are already prepared.
    window.location.href = `mailto:?subject=${encodeURIComponent(managementSubject(result.management))}&body=${encodeURIComponent(message)}`;
  };

  const openManagementBoth = async (stay: GuestStay) => {
    const result = await prepareManagement.mutateAsync(stay);
    const message = buildManagementMessage(result.management, result.url);
    window.open(`https://wa.me/${MANAGEMENT_WHATSAPP}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
    window.location.href = `mailto:?subject=${encodeURIComponent(managementSubject(result.management))}&body=${encodeURIComponent(message)}`;
  };

  /**
   * Which stay's documents are open beneath its row, and why the owner is
   * about to reject them.
   *
   * The reason is per-stay rather than one shared box: opening a second stay
   * while half a sentence is typed into the first must not carry that sentence
   * across and reject the wrong guest's papers with the wrong explanation.
   */
  const [openDocuments, setOpenDocuments] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  const documents = useQuery({
    queryKey: [...GUEST_STAYS_KEY, openDocuments, 'documents'],
    queryFn: () =>
      adminFetch<{ documents: GuestDocument[] }>(
        `/api/admin/guest-stays/${openDocuments}/documents`,
      ),
    enabled: signedIn && Boolean(openDocuments),
    retry: false,
  });

  const rejectDocuments = useMutation({
    mutationFn: ({ bookingId, reason }: { bookingId: string; reason: string }) =>
      adminFetch<{ rejected: number }>(`/api/admin/guest-stays/${bookingId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
  });

  /**
   * Reject, then re-send — in that order, and only sending if the rejection
   * actually landed.
   *
   * Doing it the other way round would send the guest a link while their old
   * documents still read as verified, so a caretaker checking the stay in that
   * gap would be told everything was in order.
   */
  const rejectAndResend = async (stay: GuestStay) => {
    const reason = (rejectReason[stay.bookingId] ?? '').trim();
    await rejectDocuments.mutateAsync({ bookingId: stay.bookingId, reason });
    setRejectReason((current) => ({ ...current, [stay.bookingId]: '' }));
    // Mints a fresh token, moves the deadline if it had passed, and opens
    // WhatsApp with the message already written.
    await createOnboarding.mutateAsync(stay);
    await queryClient.invalidateQueries({ queryKey: GUEST_STAYS_KEY });
    await documents.refetch();
  };

  const verifyDocuments = useMutation({
    mutationFn: ({ bookingId, verified }: { bookingId: string; verified: boolean }) =>
      adminFetch(`/api/admin/guest-stays/${bookingId}/verify`, {
        method: 'POST',
        body: JSON.stringify({ verified }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: GUEST_STAYS_KEY }),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ENQUIRIES_KEY });
    queryClient.invalidateQueries({ queryKey: CONTACTS_KEY });
  };

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: EnquiryStatus }) =>
      adminFetch(`/api/enquiries/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: refresh,
  });

  /**
   * Sends the quote.
   *
   * With the WhatsApp Business API configured the server delivers it and
   * there is nothing more to do. Without it the server returns the composed
   * message as a wa.me link and this opens it, which is how quotes actually
   * go out today.
   *
   * The window is opened synchronously inside the mutation, not in onSuccess,
   * because Safari and mobile browsers block window.open once the call stack
   * has left the click that triggered it.
   */
  const sendQuote = useMutation({
    mutationFn: async (id: string) => {
      const result = await adminFetch<{
        delivery: 'api' | 'manual_whatsapp';
        whatsappUrl: string | null;
      }>(`/api/enquiries/${id}/quote`, {
        method: 'POST',
        body: JSON.stringify({}),
      });

      /*
        window.open returns null when a popup blocker stops it — and desktop
        Chrome stops it routinely. The server has ALREADY recorded the quote as
        sent by this point, so failing to notice left the owner stranded: no
        WhatsApp, and no Send quote button either, because the button hides
        itself the moment quoteSentAt is set.

        So the result is checked, and a blocked popup is reported rather than
        swallowed. The link is handed back to the caller either way, and the
        row offers it as an ordinary anchor — a click on a real link is never
        popup-blocked.
      */
      let opened = true;
      if (result.delivery === 'manual_whatsapp' && result.whatsappUrl) {
        opened = window.open(result.whatsappUrl, '_blank', 'noopener,noreferrer') !== null;
      }

      return { ...result, opened };
    },
    onSuccess: refresh,
  });

  /**
   * Turns a won enquiry into a booking.
   *
   * The server refuses with 409 if the dates have been taken since the enquiry
   * arrived, or if this enquiry has already been converted — both are shown to
   * the owner rather than swallowed, because the answer in each case is a
   * decision only they can make.
   */
  const convertEnquiry = useMutation({
    mutationFn: (id: string) =>
      adminFetch<{ booking: { reference: string | null; status: string } }>(
        `/api/enquiries/${id}/convert`,
        { method: 'POST', body: JSON.stringify({}) },
      ),
    onSuccess: () => {
      refresh();
      // The new booking has to appear in the readiness panel too — that list
      // is what the verification links are sent from.
      queryClient.invalidateQueries({ queryKey: GUEST_STAYS_KEY });
    },
  });

  /**
   * Withdraws a quote that was recorded but never actually sent.
   *
   * The manual path has to assume the owner pressed send in WhatsApp, because
   * nothing here can see that. This is the escape hatch that makes the
   * assumption safe — without it an abandoned send would hold the dates
   * against nobody for 24 hours.
   */
  const withdrawQuote = useMutation({
    mutationFn: (id: string) =>
      adminFetch(`/api/enquiries/${id}/quote`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const setAdvancePaid = useMutation({
    mutationFn: ({ id, paid }: { id: string; paid: boolean }) =>
      adminFetch(`/api/enquiries/${id}/advance-received`, {
        method: 'POST',
        body: JSON.stringify({ paid }),
      }),
    onSuccess: refresh,
  });

  const removeEnquiry = useMutation({
    mutationFn: (id: string) =>
      adminFetch(`/api/enquiries/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const setOptOut = useMutation({
    mutationFn: ({ phone, optOut }: { phone: string; optOut: boolean }) =>
      adminFetch(`/api/contacts/${phone}`, {
        method: 'PATCH',
        body: JSON.stringify({ marketingOptOut: optOut }),
      }),
    onSuccess: refresh,
  });

  if (session.isLoading || (session.isSuccess && !signedIn)) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const rows = enquiries.data?.enquiries ?? [];
  const quotingReady = enquiries.data?.quotingReady ?? false;
  const list = contacts.data?.contacts ?? [];
  const newCount = rows.filter((row) => row.status === 'new').length;
  const reachable = list.filter((c) => !c.marketingOptOut).length;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <AdminHeader eyebrow="Guests" title="Enquiries & contacts" />

      <main className="mx-auto max-w-[1180px] px-5 py-8 md:px-8 md:py-10">
        <section aria-label="Enquiries">
          <Heading
            icon={<Inbox size={15} />}
            title={`Enquiries${newCount ? ` · ${newCount} new` : ''}`}
            description="Everyone who filled the form on your site. These used to vanish unless the guest also clicked through to WhatsApp."
          />

          <div className="mt-4 space-y-3">
            {enquiries.isLoading && (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}

            {!enquiries.isLoading && rows.length === 0 && (
              <div className="rounded-2xl border border-border bg-card p-5">
                <p className="text-sm text-muted-foreground">
                  No enquiries yet. They'll appear here the moment someone uses
                  the form.
                </p>
              </div>
            )}

            {rows.map((row) => (
              <div
                key={row.id}
                className="rounded-2xl border border-border bg-card p-5"
                data-testid={`row-enquiry-${row.id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-journal text-xl text-primary">
                        {row.name}
                      </p>
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[.07em] ${STATUS_STYLE[row.status]}`}
                      >
                        {row.status}
                      </span>
                    </div>

                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {row.checkIn && row.checkOut ? (
                        <>
                          {format(parseISO(row.checkIn), 'd MMM')} →{' '}
                          {format(parseISO(row.checkOut), 'd MMM yyyy')}
                        </>
                      ) : (
                        'No dates given'
                      )}
                      {row.adults !== null && (
                        <>
                          {' · '}
                          {row.adults} adult{row.adults === 1 ? '' : 's'}
                          {row.children ? `, ${row.children} children` : ''}
                          {row.pets ? `, ${row.pets} pets` : ''}
                        </>
                      )}
                      {' · '}
                      received{' '}
                      {format(parseISO(row.createdAt), 'd MMM, h:mm a')}
                    </p>

                    {row.requests && (
                      <p className="mt-2 max-w-[560px] text-sm leading-6 text-foreground">
                        “{row.requests}”
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <a
                      href={`tel:${row.phone}`}
                      className="grid h-9 w-9 place-items-center rounded-full border border-border text-primary transition-colors hover:border-primary"
                      aria-label={`Call ${row.name}`}
                    >
                      <Phone size={14} />
                    </a>
                    <a
                      href={waLink(row.phone, row.name)}
                      target="_blank"
                      rel="noreferrer"
                      className="grid h-9 w-9 place-items-center rounded-full border border-border text-primary transition-colors hover:border-primary"
                      aria-label={`WhatsApp ${row.name}`}
                    >
                      <MessageCircle size={14} />
                    </a>
                    <button
                      type="button"
                      onClick={() => removeEnquiry.mutate(row.id)}
                      className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-[#A65E45] hover:text-[#A65E45]"
                      aria-label="Delete enquiry"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/*
                  The price, and the one button that sends it. Shown on every
                  card rather than behind a menu: the owner's first question
                  about a new enquiry is always "what is this worth", and the
                  answer should not need a click.
                */}
                <div className="mt-4 border-t border-border pt-4">
                  {row.quote.ok ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground">
                          {row.quote.nights} night{row.quote.nights === 1 ? '' : 's'} · {row.quote.guests} guest{row.quote.guests === 1 ? '' : 's'}
                        </p>
                        <p className="mt-1 text-sm text-primary">
                          <span className="font-bold">
                            {formatRupees(row.quote.totalPaise)}
                          </span>{' '}
                          total
                          <span className="text-muted-foreground">
                            {' '}· {formatRupees(row.quote.advancePaise)} advance
                          </span>
                        </p>
                      </div>

                      {row.quoteSentAt ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <HoldBadge hold={row.hold} />

                          {/* A quote you can only ever send once is wrong:
                              guests lose messages, holds lapse, phones change,
                              and a blocked popup means it never arrived at all.
                              The button used to vanish the moment quoteSentAt
                              was set, with no way back. */}
                          <button
                            type="button"
                            onClick={() => sendQuote.mutate(row.id)}
                            disabled={sendQuote.isPending || !quotingReady}
                            className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-[.07em] text-primary transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
                            data-testid={`button-resend-quote-${row.id}`}
                          >
                            {sendQuote.isPending && sendQuote.variables === row.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Send size={12} />
                            )}
                            Re-send quote
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setAdvancePaid.mutate({
                                id: row.id,
                                paid: row.hold.state !== 'paid',
                              })
                            }
                            disabled={setAdvancePaid.isPending}
                            className={
                              row.hold.state === 'paid'
                                ? 'flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-bold uppercase tracking-[.07em] text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40'
                                : 'flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-[11px] font-bold uppercase tracking-[.07em] text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40'
                            }
                            data-testid={`button-advance-${row.id}`}
                          >
                            {setAdvancePaid.isPending && (
                              <Loader2 size={12} className="animate-spin" />
                            )}
                            {row.hold.state === 'paid'
                              ? 'Not received after all'
                              : 'Advance received'}
                          </button>

                          {/* The step that used to be re-typing the whole stay
                              into the ledger. Creating the booking is what
                              issues the RK- reference, and with it the arrival
                              pack and the guest verification flow. */}
                          {row.convertedBookingId ? (
                            <span
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[#7A8065]/40 bg-[#7A8065]/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[.07em] text-[#4b5340]"
                              data-testid={`label-converted-${row.id}`}
                            >
                              <Check size={12} /> Booked
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => convertEnquiry.mutate(row.id)}
                              disabled={convertEnquiry.isPending}
                              title={
                                row.hold.state === 'paid'
                                  ? 'Create the booking, issue the reference and open the calendar entry'
                                  : 'The advance is not marked received — the booking will be created as pending and will not hold the dates'
                              }
                              className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-primary px-3 py-2 text-[10px] font-bold uppercase tracking-[.07em] text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
                              data-testid={`button-convert-${row.id}`}
                            >
                              {convertEnquiry.isPending &&
                              convertEnquiry.variables === row.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <CalendarPlus size={12} />
                              )}
                              Create booking
                            </button>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => sendQuote.mutate(row.id)}
                          disabled={sendQuote.isPending || !quotingReady}
                          title={
                            quotingReady
                              ? undefined
                              : 'RAJ_KUTHIR_UPI_ID and RAJ_KUTHIR_UPI_NAME are not set on the server, so there are no payment details to put in the quote.'
                          }
                          className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-[11px] font-bold uppercase tracking-[.07em] text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40"
                          data-testid={`button-send-quote-${row.id}`}
                        >
                          {sendQuote.isPending ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Send size={13} />
                          )}
                          Send quote
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="text-[13px] leading-6 text-muted-foreground">
                      No quote — {row.quote.reason}
                    </p>
                  )}

                  {sendQuote.isError && sendQuote.variables === row.id && (
                    <p className="mt-2 text-xs text-[#A65E45]" role="alert">
                      {sendQuote.error instanceof Error
                        ? sendQuote.error.message
                        : 'The quote could not be sent.'}
                    </p>
                  )}

                  {/* A refused conversion is usually a clash with dates taken
                      since the enquiry arrived, and the server says which
                      booking. That is the owner's decision to make, so it is
                      shown rather than swallowed. */}
                  {convertEnquiry.isError && convertEnquiry.variables === row.id && (
                    <p className="mt-2 text-xs text-[#A65E45]" role="alert">
                      {convertEnquiry.error instanceof Error
                        ? convertEnquiry.error.message
                        : 'The booking could not be created.'}
                    </p>
                  )}

                  {convertEnquiry.isSuccess &&
                    convertEnquiry.variables === row.id &&
                    convertEnquiry.data?.booking && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Booking created
                        {convertEnquiry.data.booking.reference
                          ? ` · ${convertEnquiry.data.booking.reference}`
                          : ''}
                        {convertEnquiry.data.booking.status === 'pending'
                          ? ' · pending, so it is not holding the dates yet'
                          : ''}
                        . It is now in Guest check-in readiness above, ready for Send info.
                      </p>
                    )}

                  {/* Says what actually happened. Opening WhatsApp is not the
                      same as delivering a message, and the dates are now held
                      on the assumption that the owner pressed send. */}
                  {sendQuote.isSuccess &&
                    sendQuote.variables === row.id &&
                    sendQuote.data?.delivery === 'manual_whatsapp' &&
                    !sendQuote.data?.opened && (
                      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#A65E45]" role="alert">
                        <span>
                          Your browser blocked the WhatsApp window, so nothing was sent.
                        </span>
                        {sendQuote.data?.whatsappUrl && (
                          <a
                            href={sendQuote.data.whatsappUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-bold underline decoration-accent underline-offset-2 hover:text-primary"
                            data-testid={`link-quote-whatsapp-${row.id}`}
                          >
                            Open WhatsApp with the quote
                          </a>
                        )}
                      </p>
                    )}

                  {sendQuote.isSuccess &&
                    sendQuote.variables === row.id &&
                    sendQuote.data?.delivery === 'manual_whatsapp' &&
                    sendQuote.data?.opened && (
                      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          WhatsApp opened with the quote. Send it there — the hold on these
                          dates started just now, and the countdown is shown above.
                        </span>
                        <button
                          type="button"
                          onClick={() => withdrawQuote.mutate(row.id)}
                          disabled={withdrawQuote.isPending}
                          className="underline decoration-accent underline-offset-2 hover:text-primary disabled:opacity-40"
                          data-testid={`button-withdraw-quote-${row.id}`}
                        >
                          Didn&rsquo;t send it? Undo
                        </button>
                      </p>
                    )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                  <span className="text-[10px] font-bold uppercase tracking-[.07em] text-muted-foreground">
                    {row.phone}
                  </span>
                  <span className="ml-auto flex flex-wrap gap-1.5">
                    {STATUSES.map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setStatus.mutate({ id: row.id, status })}
                        disabled={row.status === status}
                        className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[.07em] transition-colors ${row.status === status ? 'cursor-default border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary hover:text-primary'}`}
                        data-testid={`button-enquiry-${status}-${row.id}`}
                      >
                        {status}
                      </button>
                    ))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10" aria-label="Upcoming guest stays">
          <Heading
            icon={<Users size={15} />}
            title="Guest check-in readiness"
            description="Pre-arrival verification, document status, guest confirmation and management handoff. Management messages never contain pricing or payment information."
          />
          <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-[.08em] text-muted-foreground">
                  <th className="px-5 py-3 font-bold">Guest / stay</th>
                  <th className="px-5 py-3 font-bold">Verification</th>
                  <th className="px-5 py-3 font-bold">Documents</th>
                  <th className="px-5 py-3 font-bold text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {(guestStays.data?.stays ?? []).map((stay) => {
                  const verified = stay.onboardingStatus === 'verified';
                  const submitted = stay.onboardingStatus === 'submitted';
                  const deadline = stay.verificationDeadline ? new Date(stay.verificationDeadline) : null;
                  const deadlinePassed = Boolean(deadline && deadline.getTime() <= Date.now() && !verified);
                  const filed =
                    stay.documents.verified +
                    stay.documents.submitted +
                    stay.documents.rejected +
                    stay.documents.pending;
                  const isOpen = openDocuments === stay.bookingId;
                  return (
                    <Fragment key={stay.bookingId}>
                    <tr className="border-b border-border last:border-0" data-testid={`row-guest-stay-${stay.bookingId}`}>
                      <td className="px-5 py-4">
                        <p className="font-medium text-foreground">{stay.guestName ?? 'Unnamed guest'}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {format(parseISO(stay.checkIn), 'd MMM yyyy')} → {format(parseISO(stay.checkOut), 'd MMM yyyy')} · {stay.guests ?? '—'} guests
                          {stay.pets ? ` · ${stay.pets} pet${stay.pets === 1 ? '' : 's'}` : ''}
                        </p>
                        <p className="mt-1 font-mono-ui text-[10px] text-muted-foreground">{stay.reference ?? 'No Raj Kuthir reference'}</p>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.07em] ${verified ? 'border-[#7A8065]/40 bg-[#7A8065]/10 text-[#4b5340]' : deadlinePassed ? 'border-[#A65E45]/40 bg-[#A65E45]/10 text-[#A65E45]' : submitted ? 'border-[#d8a24a]/40 bg-[#d8a24a]/10 text-[#8a6320]' : 'border-border text-muted-foreground'}`}>
                          {verified ? 'Verified' : deadlinePassed ? 'Deadline passed' : submitted ? 'Awaiting verification' : 'Not submitted'}
                        </span>
                        {deadline && !verified && (
                          <p className="mt-2 text-[10px] text-muted-foreground">Deadline {format(deadline, 'd MMM, h:mm a')}</p>
                        )}
                      </td>
                      <td className="px-5 py-4 text-xs text-muted-foreground">
                        <p>{stay.documents.verified} verified · {stay.documents.submitted} submitted · {stay.documents.rejected} rejected</p>
                        {filed > 0 && (
                          <button
                            type="button"
                            onClick={() => setOpenDocuments(isOpen ? null : stay.bookingId)}
                            className="mt-2 flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[.07em] text-primary transition-colors hover:border-primary"
                            aria-expanded={isOpen}
                            data-testid={`button-view-documents-${stay.bookingId}`}
                          >
                            <FileText size={12} /> {isOpen ? 'Hide' : 'View'} {filed} file{filed === 1 ? '' : 's'}
                          </button>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          {submitted && !verified && (
                            <button type="button" onClick={() => verifyDocuments.mutate({ bookingId: stay.bookingId, verified: true })} className="rounded-lg border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-[.07em] text-primary hover:border-primary">Verify</button>
                          )}
                          <button type="button" onClick={() => createOnboarding.mutate(stay)} disabled={createOnboarding.isPending || !stay.guestPhone} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[10px] font-bold uppercase tracking-[.07em] text-primary-foreground disabled:opacity-40" data-testid={`button-whatsapp-guest-${stay.bookingId}`}>
                            {createOnboarding.isPending ? <Loader2 size={12} className="animate-spin" /> : <MessageCircle size={12} />} Guest WhatsApp
                          </button>
                          <button type="button" onClick={() => openManagementWhatsApp(stay).catch((e) => window.alert(e instanceof Error ? e.message : 'Could not prepare management WhatsApp.'))} disabled={prepareManagement.isPending} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-[.07em] text-primary hover:border-primary disabled:opacity-40" data-testid={`button-whatsapp-management-${stay.bookingId}`}>
                            <MessageCircle size={12} /> Mgmt WA
                          </button>
                          <button type="button" onClick={() => openManagementEmail(stay).catch((e) => window.alert(e instanceof Error ? e.message : 'Could not prepare management email.'))} disabled={prepareManagement.isPending} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-[.07em] text-primary hover:border-primary disabled:opacity-40" data-testid={`button-email-management-${stay.bookingId}`}>
                            <Send size={12} /> Mgmt Email
                          </button>
                          <button type="button" onClick={() => openManagementBoth(stay).catch((e) => window.alert(e instanceof Error ? e.message : 'Could not prepare management message.'))} disabled={prepareManagement.isPending} className="rounded-lg border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-[.07em] text-primary hover:border-primary disabled:opacity-40" data-testid={`button-both-management-${stay.bookingId}`}>
                            Both
                          </button>
                        </div>
                        {createOnboarding.isError && createOnboarding.variables?.bookingId === stay.bookingId && <p className="mt-2 text-xs text-[#A65E45]">{createOnboarding.error instanceof Error ? createOnboarding.error.message : 'Could not prepare WhatsApp.'}</p>}
                      </td>
                    </tr>

                    {/* The documents themselves, opened in place rather than
                        behind a management link. Each file is fetched from an
                        admin-only route with the session cookie and shown in a
                        new tab; nothing is written to disk and nothing is
                        cached. */}
                    {isOpen && (
                      <tr className="border-b border-border bg-background/60" data-testid={`row-documents-${stay.bookingId}`}>
                        <td colSpan={4} className="px-5 py-5">
                          {documents.isLoading && <p className="text-sm text-muted-foreground">Opening documents…</p>}

                          {documents.isError && (
                            <p className="text-sm text-[#A65E45]">
                              {documents.error instanceof Error ? documents.error.message : 'Could not load the documents.'}
                            </p>
                          )}

                          {!documents.isLoading && !documents.isError && (
                            <>
                              <ul className="space-y-2">
                                {(documents.data?.documents ?? []).map((doc) => (
                                  <li
                                    key={doc.id}
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
                                    data-testid={`document-${doc.id}`}
                                  >
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium text-foreground">
                                        {doc.documentType}
                                        {doc.documentNumber ? ` · ${doc.documentNumber}` : ''}
                                      </p>
                                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                        {doc.originalFilename ?? 'Unnamed file'}
                                        {doc.sizeBytes ? ` · ${Math.round(doc.sizeBytes / 1024)} KB` : ''}
                                        {doc.uploadedAt ? ` · ${format(parseISO(doc.uploadedAt), 'd MMM, h:mm a')}` : ''}
                                      </p>
                                      {doc.status === 'rejected' && (
                                        <p className="mt-1 text-xs text-[#A65E45]">
                                          Rejected{doc.rejectionReason ? ` — ${doc.rejectionReason}` : ''}
                                        </p>
                                      )}
                                      {doc.status === 'verified' && doc.verifiedBy === VERIFIED_ON_UPLOAD && (
                                        <p className="mt-1 text-xs text-muted-foreground">
                                          Marked verified on upload — not yet opened by anyone.
                                        </p>
                                      )}
                                    </div>
                                    <a
                                      href={`/api/admin/guest-stays/${stay.bookingId}/documents/${doc.id}/file`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-[.07em] text-primary transition-colors hover:border-primary"
                                      data-testid={`link-open-document-${doc.id}`}
                                    >
                                      <ExternalLink size={12} /> Open
                                    </a>
                                  </li>
                                ))}
                              </ul>

                              {(documents.data?.documents ?? []).length === 0 && (
                                <p className="text-sm text-muted-foreground">Nothing filed for this stay.</p>
                              )}

                              {/* The veto. One click both un-verifies what was
                                  filed and opens WhatsApp with a fresh link,
                                  because a rejection the guest is never told
                                  about is just a stay that quietly stops being
                                  ready. */}
                              {(documents.data?.documents ?? []).length > 0 && (
                                <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
                                  <label className="min-w-[240px] flex-1">
                                    <span className="eyebrow text-muted-foreground">Why are these being rejected? (optional)</span>
                                    <input
                                      value={rejectReason[stay.bookingId] ?? ''}
                                      onChange={(event) =>
                                        setRejectReason((current) => ({
                                          ...current,
                                          [stay.bookingId]: event.target.value,
                                        }))
                                      }
                                      placeholder="The photo is too blurred to read the number"
                                      className="mt-2 w-full border-b border-border bg-transparent px-0 py-2 text-sm text-primary outline-none placeholder:text-muted-foreground/50 focus:border-primary"
                                      data-testid={`input-reject-reason-${stay.bookingId}`}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      rejectAndResend(stay).catch((error) =>
                                        window.alert(error instanceof Error ? error.message : 'Could not reject and re-send.'),
                                      )
                                    }
                                    disabled={rejectDocuments.isPending || createOnboarding.isPending || !stay.guestPhone}
                                    className="flex items-center gap-1.5 rounded-lg border border-[#A65E45]/40 bg-[#A65E45]/5 px-3 py-2.5 text-[10px] font-bold uppercase tracking-[.07em] text-[#A65E45] transition-colors hover:border-[#A65E45] disabled:opacity-40"
                                    data-testid={`button-reject-resend-${stay.bookingId}`}
                                  >
                                    {rejectDocuments.isPending || createOnboarding.isPending ? (
                                      <Loader2 size={12} className="animate-spin" />
                                    ) : (
                                      <XCircle size={12} />
                                    )}
                                    Reject &amp; re-send link
                                  </button>
                                  {!stay.guestPhone && (
                                    <p className="text-xs text-muted-foreground">
                                      No mobile number on this booking, so a new link cannot be sent.
                                    </p>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {guestStays.isLoading && <p className="p-5 text-sm text-muted-foreground">Loading guest stays…</p>}
            {/* An empty list and a failed request are different things. This
                panel used to render "No bookings yet." for both, which is how a
                500 from /api/admin/guest-stays looked exactly like a quiet
                Tuesday. Say which one it is. */}
            {!guestStays.isLoading && guestStays.isError && (
              <div className="p-5">
                <p className="text-sm font-semibold text-[#A65E45]">Could not load guest stays.</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {guestStays.error instanceof Error ? guestStays.error.message : 'The server did not answer.'}
                </p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  This is not the same as having no bookings — the readiness list is
                  unavailable, so the WhatsApp actions below cannot attach a verification link.
                </p>
                <button
                  type="button"
                  onClick={() => void guestStays.refetch()}
                  className="mt-3 rounded-lg border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-[.07em] text-primary hover:border-primary"
                  data-testid="button-retry-guest-stays"
                >
                  Try again
                </button>
              </div>
            )}
            {!guestStays.isLoading && !guestStays.isError && (guestStays.data?.stays ?? []).length === 0 && <p className="p-5 text-sm text-muted-foreground">No bookings yet.</p>}
          </div>
        </section>

        <section className="mt-10 pb-6" aria-label="Guest contacts">
          <Heading
            icon={<Users size={15} />}
            title={`Guest list · ${reachable} reachable`}
            description="Built automatically from bookings and enquiries, matched on phone number. Use it for follow-ups and offers."
          />

          <div className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-card p-4">
            <BellOff size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-5 text-muted-foreground">
              Mark anyone who asks as opted out and they'll be excluded from the
              reachable count. Worth honouring properly — unsolicited marketing
              messages are regulated in India, and one complaint is more
              expensive than a hundred sends are worth.
            </p>
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-[.08em] text-muted-foreground">
                  <th className="px-5 py-3 font-bold">Guest</th>
                  <th className="px-5 py-3 font-bold">Phone</th>
                  <th className="px-5 py-3 text-right font-bold">Stays</th>
                  <th className="px-5 py-3 text-right font-bold">Spent</th>
                  <th className="px-5 py-3 font-bold">Last seen</th>
                  <th className="px-5 py-3 font-bold">Marketing</th>
                  <th className="px-5 py-3 text-right font-bold">Action</th>
                </tr>
              </thead>
              <tbody>
                {contacts.isLoading && (
                  <tr>
                    <td colSpan={7} className="px-5 py-6 text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                )}

                {!contacts.isLoading && list.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-6 text-muted-foreground">
                      No contacts yet. They build up as bookings and enquiries
                      arrive.
                    </td>
                  </tr>
                )}

                {list.map((contact) => (
                  <tr
                    key={contact.phone}
                    className="border-b border-border last:border-0"
                    data-testid={`row-contact-${contact.phone}`}
                  >
                    <td className="px-5 py-3 font-medium text-foreground">
                      {contact.name ?? '—'}
                    </td>
                    <td className="px-5 py-3 font-mono-ui text-[11px] text-muted-foreground">
                      {contact.phone}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                      {contact.stays}
                      {contact.enquiryCount > 0 && (
                        <span className="ml-1 text-[10px]">
                          (+{contact.enquiryCount} enq)
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-foreground">
                      {formatRupees(contact.totalSpentPaise)}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {contact.lastStay
                        ? format(parseISO(contact.lastStay), 'd MMM yyyy')
                        : contact.lastEnquiry
                          ? `enq ${format(parseISO(contact.lastEnquiry), 'd MMM')}`
                          : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        onClick={() =>
                          setOptOut.mutate({
                            phone: contact.phone,
                            optOut: !contact.marketingOptOut,
                          })
                        }
                        className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[.07em] transition-colors ${contact.marketingOptOut ? 'border-[#A65E45]/40 bg-[#A65E45]/10 text-[#A65E45]' : 'border-border text-muted-foreground hover:border-primary hover:text-primary'}`}
                        data-testid={`button-optout-${contact.phone}`}
                      >
                        {contact.marketingOptOut ? 'Opted out' : 'Reachable'}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {(() => {
                        const matchingStays = (guestStays.data?.stays ?? []).filter(
                          (stay) => stay.guestPhone?.replace(/\D/g, '') === contact.phone.replace(/\D/g, ''),
                        );
                        const stay = matchingStays.find((item) => item.status !== 'cancelled') ?? matchingStays[0];
                        return stay ? (
                          <button
                            type="button"
                            onClick={() => createOnboarding.mutate(stay)}
                            disabled={createOnboarding.isPending || !stay.guestPhone}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[10px] font-bold uppercase tracking-[.07em] text-primary-foreground disabled:opacity-40"
                            data-testid={`button-whatsapp-contact-${contact.phone}`}
                            title="Send the booking confirmation and document-verification link on WhatsApp"
                          >
                            <MessageCircle size={12} /> WhatsApp
                          </button>
                        ) : guestStays.isError ? (
                          // The stays list failed to load, so we cannot tell
                          // whether this guest has a booking. Sending the
                          // generic message here would quietly omit the
                          // mandatory verification link, which is the one part
                          // that must not go missing. Refuse instead.
                          <button
                            type="button"
                            disabled
                            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-[#A65E45]/40 px-3 py-2 text-[10px] font-bold uppercase tracking-[.07em] text-[#A65E45] opacity-70"
                            data-testid={`button-whatsapp-contact-${contact.phone}`}
                            title="Guest stays could not be loaded, so the verification link cannot be attached"
                          >
                            <MessageCircle size={12} /> Unavailable
                          </button>
                        ) : (
                          <a
                            href={waLink(contact.phone, contact.name)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-[.07em] text-primary hover:border-primary"
                            data-testid={`button-whatsapp-contact-${contact.phone}`}
                            title="No booking found for this number — opens WhatsApp without a verification link"
                          >
                            <MessageCircle size={12} /> WhatsApp
                          </a>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function prettyGuestDate(value: string): string {
  return format(parseISO(value), 'd MMMM yyyy (EEEE)');
}

function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.max(0, Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400000));
}

function money(paise: number | null): string {
  if (paise == null) return 'To be confirmed';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(paise / 100);
}

function buildGuestWhatsAppMessage(stay: GuestStay, verificationUrl: string): string {
  const nights = nightsBetween(stay.checkIn, stay.checkOut);
  const total = money(stay.grossPaise);
  const advance = money(stay.receivedPaise);
  const balance = stay.grossPaise != null && stay.receivedPaise != null
    ? money(Math.max(0, stay.grossPaise - stay.receivedPaise))
    : 'To be confirmed';
  return `Greetings from Raj Kuthir Homestays – Sobuj Potro, Shantiniketan! 🌿\n\nDear ${stay.guestName ?? 'Guest'},\n\nThank you for choosing Raj Kuthir Homestays – Sobuj Potro. We are pleased to confirm your booking.\n\n🔴 IMPORTANT – ACTION REQUIRED BEFORE ARRIVAL\n\n📄 Document Verification / Pre-Arrival Check-in:\n${verificationUrl}\n\nPlease complete the mandatory guest information and ID document verification at least 48 hours before your scheduled check-in time.\n\n⚠️ Failure to complete the mandatory verification within this timeframe may result in check-in being denied without refund, in accordance with the booking terms.\n\n📅 Check-in: ${prettyGuestDate(stay.checkIn)} – ${CHECK_IN_TIME} onwards\n📅 Check-out: ${prettyGuestDate(stay.checkOut)} – ${CHECK_OUT_TIME}\n👥 Guests: ${stay.guests ?? 'As booked'}\n🏡 Accommodation: Entire Two-Bedroom Villa${nights ? ` (${nights} Nights)` : ''}${stay.pets ? `\n🐾 Pets: ${stay.pets}` : ''}\n\n💰 Booking Details\n\n- Total Booking Amount: ₹${total}\n- Advance Received: ₹${advance} ✅\n- Balance Amount Due: ₹${balance} (Payable at the property during check-in)\n\n📍 Google Maps: https://maps.app.goo.gl/aEdaJaaeEy1DZ8Ps8?g_st=ac\n\n📞 Contact Numbers\n- Host: +91 62903 99165\n- Designated Caretaker: +91 78726 85558\n\nAdditional Information\n\n- High-speed Wi-Fi is available and suitable for work/staycations.\n- Cafe Soi, located within the premises, serves snacks and beverages.\n- Home-cooked meals can also be arranged after discussing the menu and charges directly with the caretaker.\n- Zomato is available in the area with multiple restaurant options. Delivery availability and timings may vary depending on weather and local conditions.\n- Basic cooking utensils are available for simple meals. Additional utensils for elaborate cooking can be arranged subject to availability. Guests are also welcome to bring their own induction/microwave-compatible cookware if required.\n\nWe look forward to hosting you and wish you a wonderful stay at Raj Kuthir Homestays – Sobuj Potro.\n\nWarm regards,\nTeam Raj Kuthir Homestays – Sobuj Potro`;
}

function buildManagementMessage(
  dto: ManagementGuestVerification,
  managementUrl: string,
): string {
  // Note the parameter type. This function cannot reach a financial field
  // because it is never given one.
  const docs = [
    ...(dto.documents.verified
      ? [`${dto.documents.verified} ID document${dto.documents.verified === 1 ? '' : 's'} \u2014 Verified`]
      : []),
    ...(dto.documents.submitted
      ? [`${dto.documents.submitted} ID document${dto.documents.submitted === 1 ? '' : 's'} \u2014 Uploaded / Pending verification`]
      : []),
    ...(dto.documents.rejected
      ? [`${dto.documents.rejected} ID document${dto.documents.rejected === 1 ? '' : 's'} \u2014 Rejected`]
      : []),
  ];

  const READINESS: Record<ManagementGuestVerification['readiness'], string> = {
    ready: 'Ready for check-in \u2014 all documents verified',
    documents_submitted: 'Documents uploaded \u2014 awaiting verification',
    awaiting_documents: 'Awaiting guest documents',
    // Reported, never acted on. The property decides what happens to the
    // booking; this system does not cancel or refuse anything.
    deadline_passed: 'Verification deadline passed \u2014 property to decide on check-in',
    blocked: 'Check-in blocked \u2014 property to decide',
  };

  return [
    'SOBUJ POTRO \u2014 GUEST ARRIVAL / VERIFICATION',
    '',
    `Guest: ${dto.guestName ?? 'Not provided'}`,
    `Number: ${dto.guestPhone ?? 'Not provided'}`,
    `Check-in: ${prettyGuestDate(dto.checkIn)}`,
    `Check-out: ${prettyGuestDate(dto.checkOut)}`,
    '',
    'Guest ID documents:',
    ...(docs.length ? docs.map((doc, i) => `${i + 1}. ${doc}`) : ['1. No documents uploaded yet']),
    '',
    `Status: ${READINESS[dto.readiness]}`,
    '',
    'Secure document access:',
    managementUrl,
  ].join('\n');
}

function Heading({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-accent">
        {icon}
        {title}
      </p>
      <p className="mt-2 max-w-[600px] text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

/**
 * What is happening to these dates right now.
 *
 * Four states, and the one that matters is "released" — it is the only one
 * that means the owner is free to sell the dates to somebody else, and it
 * arrives without anybody doing anything.
 */
function HoldBadge({ hold }: { hold: HoldState }) {
  if (hold.state === 'paid') {
    return (
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.07em] text-[#4b5340]">
        <Timer size={11} /> Advance received{' '}
        {format(parseISO(hold.paidAt), 'd MMM')}
      </span>
    );
  }

  if (hold.state === 'held') {
    return (
      <span
        className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.07em] text-primary"
        title={`Releases ${format(parseISO(hold.expiresAt), "d MMM, h:mm a")}`}
      >
        <Timer size={11} /> Held · {hold.hoursLeft}h left
      </span>
    );
  }

  if (hold.state === 'released') {
    return (
      <span
        className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.07em] text-[#A65E45]"
        title={`Released ${format(parseISO(hold.expiresAt), "d MMM, h:mm a")}`}
      >
        <Timer size={11} /> Released — dates back on sale
      </span>
    );
  }

  return null;
}
