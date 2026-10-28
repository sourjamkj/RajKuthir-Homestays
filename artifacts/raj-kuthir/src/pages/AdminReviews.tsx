import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Flag,
  Loader2,
  MessageCircle,
  PhoneCall,
  Plus,
  RefreshCw,
  Send,
  Star,
  X,
} from 'lucide-react';

import { adminFetch, useAdminSession } from '@/lib/admin-api';
import { AdminHeader } from '@/components/AdminHeader';

/**
 * Reviews: asking guests for a Google review, and replying to the reviews
 * that come in. Nothing here messages a guest or posts to Google without a
 * press of a button on this screen.
 */

const KEY = ['/api/admin/reviews'];

type Variant = 'general' | 'pet' | 'short';

type RequestRow = {
  id: string;
  bookingId: string | null;
  status: 'draft' | 'pending' | 'sent' | 'failed' | 'cancelled';
  guestName: string | null;
  source: string | null;
  checkIn: string | null;
  checkOut: string | null;
  pets: number;
  nights: number;
  variant: Variant | null;
  autoVariant: Variant | null;
  variantReason: string;
  ota: boolean;
  note: string | null;
  preview: string;
  sendAfter: string;
  cutoff: string | null;
  sentAt: string | null;
  manualWhatsappUrl: string;
};

type Stay = {
  bookingId: string;
  guestName: string | null;
  source: string;
  checkIn: string;
  checkOut: string;
  issue: { note: string | null; flaggedAt: string; resolvedAt: string | null } | null;
  hasReviewRequest: boolean;
};

type Review = {
  id: string;
  source: 'gbp' | 'manual';
  reviewerName: string | null;
  rating: number;
  text: string | null;
  createdAt: string;
  replyText: string | null;
  replyStatus: 'none' | 'draft' | 'approved' | 'posted' | 'skipped';
  replyNote: string | null;
  matchedBooking: { id: string; guestName: string | null; checkIn: string; checkOut: string; pets: number | null; source: string } | null;
};

type Data = {
  source: 'gbp' | 'manual';
  drafter: boolean;
  whatsappSending: boolean;
  newTemplatesLive: boolean;
  listingUrl: string;
  leaveReviewUrl: string;
  reviews: Review[];
  requests: RequestRow[];
  stays: Stay[];
  tasks: Array<{ bookingId: string; guestName: string | null; checkOut: string; note: string | null }>;
};

const VARIANT_LABEL: Record<Variant, string> = { general: 'General', pet: 'Pet', short: '1-night' };
const STATUS_LABEL: Record<RequestRow['status'], string> = {
  draft: 'Waiting for you',
  pending: 'Released — sends automatically',
  sent: 'Sent',
  failed: 'Not sent',
  cancelled: 'Skipped',
};
const SOURCE_LABEL: Record<string, string> = {
  direct: 'Direct',
  manual: 'Manual',
  bookingCom: 'Booking.com',
  airbnb: 'Airbnb',
  makeMyTrip: 'MMT / Goibibo',
};

const BTN =
  'inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-[.08em] disabled:opacity-40';
const BTN_PRIMARY = `${BTN} bg-primary text-primary-foreground`;
const BTN_OUTLINE = `${BTN} border border-border text-primary hover:border-primary`;
const CARD = 'rounded-2xl border border-border bg-card p-4';

const day = (iso: string | null) => {
  if (!iso) return '?';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y!, m! - 1, d!)));
};
const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso))
    : '—';
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
const hasFix = (text: string) => /\[FIX\b/i.test(text);
const todayIst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export default function AdminReviews() {
  const [, navigate] = useLocation();
  const session = useAdminSession();
  const signedIn = session.data?.signedIn === true;
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (session.isSuccess && !signedIn) navigate('/admin/login', { replace: true });
  }, [session.isSuccess, signedIn, navigate]);

  const query = useQuery({
    queryKey: KEY,
    queryFn: () => adminFetch<Data>('/api/admin/reviews'),
    enabled: signedIn,
    refetchInterval: 120_000,
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: KEY });
  const act = useMutation({
    mutationFn: async (input: { path: string; method?: string; body?: unknown; done?: string }) => {
      await adminFetch(input.path, { method: input.method ?? 'POST', body: JSON.stringify(input.body ?? {}) });
      return input.done ?? null;
    },
    onSuccess: (done) => {
      if (done) setMessage(done);
      refresh();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Something went wrong.'),
  });

  if (session.isLoading || (session.isSuccess && !signedIn)) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const data = query.data;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <AdminHeader eyebrow="Guests" title="Google reviews" />
      <main className="mx-auto max-w-[1180px] space-y-10 px-5 py-8 md:px-8 md:py-10">
        {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {query.isError && <p className="text-sm text-[#A65E45]">{query.error instanceof Error ? query.error.message : 'Could not load.'}</p>}
        {message && (
          <p className="flex items-start justify-between gap-3 rounded-xl bg-secondary p-3 text-[13px] text-primary" role="status">
            {message}
            <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss"><X size={14} /></button>
          </p>
        )}

        {data && (
          <>
            <StatusStrip data={data} />
            {data.tasks.length > 0 && <IssueTasks data={data} act={act} />}
            <RequestQueue data={data} act={act} />
            <RecentStays data={data} act={act} />
            <ReviewReplies data={data} act={act} setMessage={setMessage} />
          </>
        )}
      </main>
    </div>
  );
}

type Act = ReturnType<typeof useMutation<string | null, Error, { path: string; method?: string; body?: unknown; done?: string }>>;

function StatusStrip({ data }: { data: Data }) {
  const chip = (ok: boolean, on: string, off: string) => (
    <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${ok ? 'bg-[#7A8065]/15 text-[#4b5340]' : 'bg-[#d8a24a]/15 text-[#8a6320]'}`}>{ok ? on : off}</span>
  );
  return (
    <div className="flex flex-wrap gap-2">
      {chip(data.source === 'gbp', 'Google reviews: fetched automatically', 'Google reviews: add them by hand (API not connected)')}
      {chip(data.drafter, 'Reply drafts: written by Claude', 'Reply drafts: simple templates (no ANTHROPIC_API_KEY)')}
      {chip(data.whatsappSending, 'WhatsApp: released asks send automatically', 'WhatsApp: send asks from your phone')}
      {data.whatsappSending && chip(data.newTemplatesLive, 'Templates: new 3 variants', 'Templates: old rk_review_request until the new ones are approved')}
    </div>
  );
}

/* ------------------------------ Part A ------------------------------ */

function IssueTasks({ data, act }: { data: Data; act: Act }) {
  return (
    <section aria-label="Calls to make">
      <p className="eyebrow flex items-center gap-2 text-[#A65E45]"><PhoneCall size={15} /> To do</p>
      <h2 className="mt-1 font-journal text-2xl text-primary">Call guest about issue</h2>
      <ul className="mt-4 space-y-3">
        {data.tasks.map((task) => (
          <li key={task.bookingId} className={`${CARD} border-[#A65E45]/40`}>
            <p className="font-bold text-primary">{task.guestName ?? 'Guest'} <span className="font-normal text-muted-foreground">· checked out {day(task.checkOut)}</span></p>
            {task.note && <p className="mt-1 text-[13px] text-primary/80">{task.note}</p>}
            <p className="mt-1 text-[12px] text-muted-foreground">No review request goes to this guest while the issue is open.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={BTN_PRIMARY} disabled={act.isPending} onClick={() => act.mutate({ path: `/api/admin/bookings/${task.bookingId}/issue/resolved`, done: 'Marked as called.' })}>
                <Check size={13} /> Called — done
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RequestQueue({ data, act }: { data: Data; act: Act }) {
  const waiting = data.requests.filter((row) => row.status === 'draft' || row.status === 'pending');
  const rest = data.requests.filter((row) => row.status !== 'draft' && row.status !== 'pending');

  const card = (row: RequestRow) => {
    const open = row.status === 'draft' || row.status === 'pending';
    return (
      <li key={row.id} className={CARD} data-testid={`review-request-${row.id}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-bold text-primary">
              {row.guestName ?? 'Guest'}{' '}
              <span className="font-normal text-muted-foreground">
                · {day(row.checkIn)} → {day(row.checkOut)} · {SOURCE_LABEL[row.source ?? ''] ?? row.source}
              </span>
            </p>
            <p className="mt-1 text-[13px] text-primary/80">
              <span className="mr-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold">{row.variant ? VARIANT_LABEL[row.variant] : 'Old template'}</span>
              {row.variantReason}
            </p>
          </div>
          <span className="rounded-full bg-secondary px-3 py-1 text-[10px] font-bold uppercase tracking-[.08em] text-primary">{STATUS_LABEL[row.status]}</span>
        </div>

        {row.ota && open && (
          <p className="mt-2 flex items-start gap-1.5 text-[12px] text-[#8a6320]"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> OTA booking — draft only. Check the channel's guest-contact rules before sending.</p>
        )}
        {row.note && !row.ota && <p className="mt-2 text-[12px] text-muted-foreground">{row.note}</p>}

        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] font-bold text-accent">Message</summary>
          <p className="mt-2 whitespace-pre-wrap text-[13px] text-primary/80">{row.preview}</p>
        </details>

        <p className="mt-2 text-[12px] text-muted-foreground">
          {row.status === 'sent' ? `Sent ${when(row.sentAt)}` : `Goes at ${when(row.sendAfter)} · last chance ${when(row.cutoff)}`}
        </p>

        {open && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-[12px] text-muted-foreground" htmlFor={`variant-${row.id}`}>Variant</label>
            <select
              id={`variant-${row.id}`}
              value={row.variant ?? ''}
              disabled={act.isPending}
              onChange={(event) => act.mutate({ path: `/api/admin/review-requests/${row.id}/variant`, body: { variant: event.target.value }, done: 'Variant switched.' })}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-[12px] text-primary"
            >
              {(['general', 'pet', 'short'] as Variant[]).map((variant) => (
                <option key={variant} value={variant}>{VARIANT_LABEL[variant]}{variant === row.autoVariant ? ' (automatic)' : ''}</option>
              ))}
            </select>
            <a href={row.manualWhatsappUrl} target="_blank" rel="noreferrer" className={BTN_PRIMARY}>
              <MessageCircle size={13} /> Send from my WhatsApp
            </a>
            <button type="button" className={BTN_OUTLINE} disabled={act.isPending} onClick={() => act.mutate({ path: `/api/admin/review-requests/${row.id}/sent-manually`, done: 'Marked as sent.' })}>
              <Check size={13} /> Mark sent
            </button>
            {data.whatsappSending && row.status === 'draft' && (
              <button type="button" className={BTN_OUTLINE} disabled={act.isPending} onClick={() => act.mutate({ path: `/api/admin/review-requests/${row.id}/approve`, done: 'Released — it goes out automatically at the time shown.' })}>
                <Send size={13} /> Release to auto-send
              </button>
            )}
            <button type="button" className={`${BTN} border border-[#A65E45]/50 text-[#A65E45]`} disabled={act.isPending} onClick={() => act.mutate({ path: `/api/admin/review-requests/${row.id}/cancel`, done: 'Cancelled.' })}>
              <X size={13} /> Don't send
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <section aria-label="Review requests">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow flex items-center gap-2 text-accent"><Star size={15} /> Part 1</p>
          <h2 className="mt-1 font-journal text-2xl text-primary">Review requests{waiting.length ? ` · ${waiting.length}` : ''}</h2>
          <p className="mt-1 max-w-[640px] text-[13px] text-muted-foreground">
            Queued on check-out day for 2 pm, same message for every guest. Nothing goes out until you send it or release it.
          </p>
        </div>
        <button type="button" className={BTN_OUTLINE} disabled={act.isPending} onClick={() => act.mutate({ path: '/api/admin/review-requests/refresh', done: 'Checked for stays that just ended.' })}>
          <RefreshCw size={13} /> Check now
        </button>
      </div>
      {waiting.length === 0 && <p className="mt-4 text-sm text-muted-foreground">Nothing waiting. New asks appear here on check-out day.</p>}
      {waiting.length > 0 && <ul className="mt-4 space-y-3">{waiting.map(card)}</ul>}
      {rest.length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground">Sent and skipped, last 30 days ({rest.length})</summary>
          <ul className="mt-2 space-y-3">{rest.map(card)}</ul>
        </details>
      )}
    </section>
  );
}

function RecentStays({ data, act }: { data: Data; act: Act }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (!data.stays.length) return null;
  const today = todayIst();
  return (
    <section aria-label="Recent stays">
      <p className="eyebrow flex items-center gap-2 text-accent"><Flag size={15} /> Issues during a stay</p>
      <h2 className="mt-1 font-journal text-2xl text-primary">Recent stays</h2>
      <p className="mt-1 max-w-[640px] text-[13px] text-muted-foreground">
        Flag a stay that had a problem: it gets no review request, and you get a reminder to call the guest.
      </p>
      <ul className="mt-4 divide-y divide-border rounded-2xl border border-border bg-card">
        {data.stays.map((stay) => {
          const open = stay.issue && !stay.issue.resolvedAt;
          return (
            <li key={stay.bookingId} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-bold text-primary">{stay.guestName ?? 'Guest'} <span className="font-normal text-muted-foreground">· {day(stay.checkIn)} → {day(stay.checkOut)} · {SOURCE_LABEL[stay.source] ?? stay.source}</span></p>
                {stay.issue && <p className="text-[12px] text-[#A65E45]">{open ? 'Issue flagged' : 'Issue handled'}{stay.issue.note ? `: ${stay.issue.note}` : ''}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!stay.issue && (
                  <>
                    <input
                      id={`issue-note-${stay.bookingId}`}
                      value={notes[stay.bookingId] ?? ''}
                      onChange={(event) => setNotes({ ...notes, [stay.bookingId]: event.target.value })}
                      placeholder="What went wrong (optional)"
                      className="rounded-full border border-border bg-background px-3 py-1.5 text-[12px]"
                    />
                    <button type="button" className={BTN_OUTLINE} disabled={act.isPending} onClick={() => act.mutate({ path: `/api/admin/bookings/${stay.bookingId}/issue`, body: { note: notes[stay.bookingId] ?? '' }, done: 'Issue flagged. No review request will go to this guest.' })}>
                      <Flag size={13} /> Flag issue
                    </button>
                  </>
                )}
                {stay.issue && (
                  <button type="button" className={BTN_OUTLINE} disabled={act.isPending} onClick={() => act.mutate({ path: `/api/admin/bookings/${stay.bookingId}/issue`, method: 'DELETE', done: 'Flag removed.' })}>
                    <X size={13} /> Remove flag
                  </button>
                )}
                {stay.issue?.resolvedAt && !stay.hasReviewRequest && stay.checkOut <= today && (
                  <button type="button" className={BTN_OUTLINE} disabled={act.isPending} onClick={() => act.mutate({ path: `/api/admin/bookings/${stay.bookingId}/review-request`, done: 'Review request queued as a draft.' })}>
                    <Star size={13} /> Queue review request anyway
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------ Part B ------------------------------ */

function ReviewReplies({ data, act, setMessage }: { data: Data; act: Act; setMessage: (text: string | null) => void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ reviewerName: '', rating: '5', date: todayIst(), text: '' });
  const [edits, setEdits] = useState<Record<string, string>>({});

  const textOf = (review: Review) => edits[review.id] ?? review.replyText ?? '';
  const copy = (text: string) => void navigator.clipboard?.writeText(text).then(() => setMessage('Reply copied. Paste it under the review on Google, then press Mark posted.'));

  return (
    <section aria-label="Replies to Google reviews">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow flex items-center gap-2 text-accent"><Star size={15} /> Part 2</p>
          <h2 className="mt-1 font-journal text-2xl text-primary">Replies to reviews</h2>
          <p className="mt-1 max-w-[640px] text-[13px] text-muted-foreground">
            Each new review gets a drafted reply. Edit it, then approve. Nothing is posted to Google until you do.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.source === 'gbp' && (
            <button type="button" className={BTN_OUTLINE} disabled={act.isPending} onClick={() => act.mutate({ path: '/api/admin/reviews/poll', done: 'Checked Google for new reviews.' })}>
              <RefreshCw size={13} /> Fetch now
            </button>
          )}
          <button type="button" className={BTN_OUTLINE} onClick={() => setAdding((value) => !value)}>
            <Plus size={13} /> Add review
          </button>
        </div>
      </div>

      {adding && (
        <form
          className={`${CARD} mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]`}
          onSubmit={(event) => {
            event.preventDefault();
            act.mutate(
              { path: '/api/admin/reviews', body: { ...draft, rating: Number(draft.rating) }, done: 'Review added and a reply drafted.' },
              { onSuccess: () => { setAdding(false); setDraft({ reviewerName: '', rating: '5', date: todayIst(), text: '' }); } },
            );
          }}
        >
          <input id="review-name" required value={draft.reviewerName} onChange={(e) => setDraft({ ...draft, reviewerName: e.target.value })} placeholder="Name as Google shows it" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <select id="review-rating" value={draft.rating} onChange={(e) => setDraft({ ...draft, rating: e.target.value })} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{stars(n)}</option>)}
          </select>
          <input id="review-date" type="date" required value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <textarea id="review-text" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="Paste the review text (leave empty for a rating-only review)" rows={3} className="rounded-lg border border-border bg-background px-3 py-2 text-sm sm:col-span-3" />
          <button type="submit" className={`${BTN_PRIMARY} sm:col-span-3 sm:justify-self-start`} disabled={act.isPending}>
            {act.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add and draft a reply
          </button>
        </form>
      )}

      {data.reviews.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          {data.source === 'gbp' ? 'No reviews fetched yet.' : 'No reviews yet. Press Add review and paste one from your Google listing.'}
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {data.reviews.map((review) => {
          const text = textOf(review);
          const fixLeft = hasFix(text);
          const editable = review.replyStatus === 'none' || review.replyStatus === 'draft' || review.replyStatus === 'skipped';
          return (
            <li key={review.id} className={`${CARD} ${review.rating <= 3 ? 'border-[#A65E45]/40' : ''}`} data-testid={`review-${review.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-primary">
                    <span className="mr-2 text-[#d8a24a]" aria-label={`${review.rating} stars`}>{stars(review.rating)}</span>
                    {review.reviewerName ?? 'Google user'}
                    <span className="font-normal text-muted-foreground"> · {day(review.createdAt)}</span>
                  </p>
                  {review.matchedBooking && (
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      Probably the stay {day(review.matchedBooking.checkIn)} → {day(review.matchedBooking.checkOut)}
                      {review.matchedBooking.pets ? ` · ${review.matchedBooking.pets} pet` : ''} (only for your reference — never put in the reply)
                    </p>
                  )}
                </div>
                <span className="rounded-full bg-secondary px-3 py-1 text-[10px] font-bold uppercase tracking-[.08em] text-primary">{review.replyStatus === 'none' ? 'Drafting…' : review.replyStatus}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[14px] text-primary/90">{review.text ?? <em className="text-muted-foreground">Rating only, no text.</em>}</p>

              {review.replyNote && <p className="mt-2 text-[12px] text-muted-foreground">{review.replyNote}</p>}

              {review.replyStatus === 'posted' && (
                <p className="mt-3 whitespace-pre-wrap rounded-xl bg-secondary p-3 text-[13px] text-primary">{review.replyText}</p>
              )}

              {editable && review.replyStatus !== 'none' && (
                <>
                  <label htmlFor={`reply-${review.id}`} className="mt-3 block text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground">Your reply</label>
                  <textarea
                    id={`reply-${review.id}`}
                    value={text}
                    onChange={(event) => setEdits({ ...edits, [review.id]: event.target.value })}
                    rows={6}
                    className="mt-1 w-full rounded-xl border border-border bg-background p-3 text-[13px] text-primary outline-none focus:border-primary"
                  />
                  {fixLeft && (
                    <p className="mt-1 flex items-start gap-1.5 text-[12px] text-[#A65E45]"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> Replace [FIX: …] with what you have done about it — approval is blocked until then.</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={BTN_PRIMARY}
                      disabled={act.isPending || fixLeft || !text.trim()}
                      onClick={() =>
                        act.mutate({
                          path: `/api/admin/reviews/${review.id}/approve`,
                          body: { text },
                          done: data.source === 'gbp' && review.source === 'gbp' ? 'Reply posted on Google.' : 'Approved. Copy it, paste it on the listing, then press Mark posted.',
                        })
                      }
                    >
                      <Check size={13} /> {data.source === 'gbp' && review.source === 'gbp' ? 'Approve & post' : 'Approve'}
                    </button>
                    <button type="button" className={BTN_OUTLINE} disabled={act.isPending || !text.trim()} onClick={() => act.mutate({ path: `/api/admin/reviews/${review.id}/reply`, method: 'PUT', body: { text }, done: 'Draft saved.' })}>
                      Save draft
                    </button>
                    <button
                      type="button"
                      className={BTN_OUTLINE}
                      disabled={act.isPending}
                      onClick={() => {
                        setEdits((current) => { const next = { ...current }; delete next[review.id]; return next; });
                        act.mutate({ path: `/api/admin/reviews/${review.id}/draft`, done: 'Redrafted.' });
                      }}
                    >
                      <RefreshCw size={13} /> Redraft
                    </button>
                    {review.replyStatus !== 'skipped' && (
                      <button type="button" className={BTN_OUTLINE} disabled={act.isPending} onClick={() => act.mutate({ path: `/api/admin/reviews/${review.id}/skip`, done: 'Skipped — no reply.' })}>
                        Skip
                      </button>
                    )}
                  </div>
                </>
              )}

              {review.replyStatus === 'approved' && (
                <>
                  <p className="mt-3 whitespace-pre-wrap rounded-xl bg-secondary p-3 text-[13px] text-primary">{review.replyText}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className={BTN_PRIMARY} onClick={() => copy(review.replyText ?? '')}><Copy size={13} /> Copy reply</button>
                    <a href={data.listingUrl} target="_blank" rel="noreferrer" className={BTN_OUTLINE}><ExternalLink size={13} /> Open listing</a>
                    <button type="button" className={BTN_OUTLINE} disabled={act.isPending} onClick={() => act.mutate({ path: `/api/admin/reviews/${review.id}/posted`, done: 'Marked as posted.' })}>
                      <Check size={13} /> Mark posted
                    </button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
