import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ExternalLink, FileText, MessageSquareText, ShieldCheck } from 'lucide-react';

import { adminFetch } from '@/lib/admin-api';
import { AdminHeader } from '@/components/AdminHeader';

/**
 * What the West Bengal Homestay Policy asks the house to keep, in one place:
 *
 *  • the guest register (check-in / check-out ledger), downloaded as CSV for
 *    any period — built from bookings and the guests' own pre-arrival forms;
 *  • Form C for foreign guests, due within 24 hours of arrival on the FRRO
 *    portal — this page reminds and records that it was filed, it does not
 *    file it;
 *  • the printable notice board, with today's tariff;
 *  • the complaints & suggestions book guests write in at /feedback.
 */

type FormCState = 'not_needed' | 'unknown' | 'filed' | 'upcoming' | 'due' | 'overdue';
type FormCItem = {
  bookingId: string;
  reference: string | null;
  guestName: string | null;
  country: string | null;
  checkIn: string;
  checkOut: string;
  state: FormCState;
  filedAt: string | null;
  filedReference: string | null;
};
type FeedbackEntry = {
  id: string;
  kind: string;
  name: string;
  contact: string | null;
  stayRef: string | null;
  message: string;
  status: 'open' | 'resolved';
  ownerNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

const FORM_C_KEY = ['/api/admin/compliance/form-c'];
const FEEDBACK_KEY = ['/api/admin/feedback'];

const STATE_LABEL: Record<FormCState, string> = {
  not_needed: 'Not needed',
  unknown: 'Nationality not given',
  filed: 'Filed',
  upcoming: 'Due within 24h of arrival',
  due: 'Due now',
  overdue: 'Overdue',
};
const STATE_TONE: Record<FormCState, string> = {
  not_needed: 'bg-muted text-muted-foreground',
  unknown: 'bg-[#d8a24a]/15 text-[#8a6320]',
  filed: 'bg-[#7A8065]/15 text-[#4b5340]',
  upcoming: 'bg-primary/10 text-primary',
  due: 'bg-[#A65E45]/15 text-[#A65E45]',
  overdue: 'bg-[#A65E45] text-white',
};

const PILL =
  'inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-[.09em] text-primary transition-colors hover:border-primary';
const input = 'mt-2 w-full border-b border-border bg-transparent px-0 py-2 text-sm text-primary outline-none focus:border-primary';

const pretty = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function AdminCompliance() {
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [registration, setRegistration] = useState('');
  const [references, setReferences] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const formC = useQuery({
    queryKey: FORM_C_KEY,
    queryFn: () => adminFetch<{ portal: string; stays: FormCItem[] }>('/api/admin/compliance/form-c'),
    retry: false,
  });
  const feedback = useQuery({
    queryKey: FEEDBACK_KEY,
    queryFn: () => adminFetch<{ entries: FeedbackEntry[] }>('/api/admin/feedback'),
    retry: false,
  });

  const fileFormC = useMutation({
    mutationFn: (input: { bookingId: string; filed: boolean; reference?: string }) =>
      adminFetch(`/api/admin/compliance/form-c/${input.bookingId}`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: FORM_C_KEY }),
  });
  const resolve = useMutation({
    mutationFn: (input: { id: string; resolved: boolean; note: string }) =>
      adminFetch(`/api/admin/feedback/${input.id}`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: FEEDBACK_KEY }),
  });

  const registerHref = `/api/admin/compliance/register.csv?${new URLSearchParams({ from, to }).toString()}`;
  const boardHref = `/api/admin/compliance/display-board.pdf${registration.trim() ? `?${new URLSearchParams({ registration: registration.trim() }).toString()}` : ''}`;
  const pending = (formC.data?.stays ?? []).filter((s) => s.state === 'due' || s.state === 'overdue');
  const open = (feedback.data?.entries ?? []).filter((e) => e.status === 'open');

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <AdminHeader eyebrow="Owner console" title="Registers & compliance" />

      <main className="section-shell space-y-8 py-12 md:py-16">
        <p className="max-w-[680px] text-sm leading-6 text-muted-foreground">
          The records the West Bengal Homestay Policy asks a registered homestay to keep. The guest register and the
          complaints book fill themselves from bookings, pre-arrival forms and the <span className="font-mono-ui text-primary">/feedback</span> page.
        </p>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-[1.4rem] border border-border bg-card p-7" data-testid="card-guest-register">
            <FileText size={22} className="text-accent" strokeWidth={1.4} />
            <p className="mt-5 font-journal text-2xl text-primary">Guest register</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Every stay arriving in the period, with the guest's address, nationality and ID documents. The policy asks
              for each arrival to be entered within 12 hours; guests fill this in through their pre-arrival link.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-4">
              <label className="block">
                <span className="eyebrow text-muted-foreground">Check-in from</span>
                <input id="register-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
              </label>
              <label className="block">
                <span className="eyebrow text-muted-foreground">to</span>
                <input id="register-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
              </label>
            </div>
            <a href={registerHref} className={`${PILL} mt-6`} data-testid="link-register-csv">
              <Download size={13} /> Download register (CSV)
            </a>
          </div>

          <div className="rounded-[1.4rem] border border-border bg-card p-7" data-testid="card-display-board">
            <ShieldCheck size={22} className="text-accent" strokeWidth={1.4} />
            <p className="mt-5 font-journal text-2xl text-primary">Notice board</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              A4 board for the wall: timings, today's tariff, guidelines, what is not allowed, emergency numbers, the
              nearest police station and health facility (from the arrival pack contacts, if listed) and the complaints
              book QR. Reprint it when prices change.
            </p>
            <label className="mt-5 block">
              <span className="eyebrow text-muted-foreground">Homestay registration no. (once issued)</span>
              <input id="board-registration" value={registration} onChange={(e) => setRegistration(e.target.value)} placeholder="Leave blank to write it in by hand" className={input} />
            </label>
            <a href={boardHref} target="_blank" rel="noreferrer" className={`${PILL} mt-6`} data-testid="link-display-board">
              <Download size={13} /> Notice board (PDF)
            </a>
          </div>
        </section>

        <section className="rounded-[1.4rem] border border-border bg-card p-7" data-testid="card-form-c">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-journal text-2xl text-primary">Form C — foreign guests</p>
              <p className="mt-2 max-w-[620px] text-xs leading-5 text-muted-foreground">
                Filed on the FRRO portal within 24 hours of a foreign guest's arrival. Stays from the last and next 30
                days whose guest is not Indian, or has not told us their nationality yet. File it on the portal, then
                mark it here.
              </p>
            </div>
            <a href={formC.data?.portal ?? 'https://indianfrro.gov.in/frro/FormC'} target="_blank" rel="noreferrer" className={PILL}>
              <ExternalLink size={13} /> Open FRRO Form C
            </a>
          </div>
          {pending.length > 0 && (
            <p className="mt-5 rounded-xl border border-[#A65E45]/40 bg-[#A65E45]/10 px-4 py-3 text-sm font-semibold text-[#A65E45]">
              {pending.length} Form C {pending.length === 1 ? 'needs' : 'need'} filing now.
            </p>
          )}
          {formC.isError && <p className="mt-5 text-sm text-terracotta">Could not load. Refresh, or sign in again.</p>}
          {formC.data && formC.data.stays.length === 0 && (
            <p className="mt-5 text-sm text-muted-foreground">No foreign or unconfirmed-nationality stays in this window.</p>
          )}
          <div className="mt-5 divide-y divide-border">
            {(formC.data?.stays ?? []).map((stay) => (
              <div key={stay.bookingId} className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4" id={`formc-${stay.bookingId}`}>
                <div className="min-w-[200px] flex-1">
                  <p className="text-sm font-semibold text-primary">{stay.guestName ?? 'Unnamed guest'}</p>
                  <p className="text-xs text-muted-foreground">
                    {pretty(stay.checkIn)} → {pretty(stay.checkOut)} · {stay.country || 'nationality not given'}
                    {stay.reference ? ` · ${stay.reference}` : ''}
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[.08em] ${STATE_TONE[stay.state]}`}>
                  {stay.state === 'filed' && stay.filedReference ? `Filed · ${stay.filedReference}` : STATE_LABEL[stay.state]}
                </span>
                {stay.state === 'filed' ? (
                  <button type="button" className="text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground underline" onClick={() => fileFormC.mutate({ bookingId: stay.bookingId, filed: false })}>
                    Undo
                  </button>
                ) : stay.state !== 'unknown' ? (
                  <div className="flex items-end gap-2">
                    <input
                      id={`formc-ref-${stay.bookingId}`}
                      value={references[stay.bookingId] ?? ''}
                      onChange={(e) => setReferences((r) => ({ ...r, [stay.bookingId]: e.target.value }))}
                      placeholder="Form C ref (optional)"
                      className="w-40 border-b border-border bg-transparent py-1 text-xs outline-none focus:border-primary"
                    />
                    <button type="button" className={PILL} onClick={() => fileFormC.mutate({ bookingId: stay.bookingId, filed: true, reference: references[stay.bookingId] ?? '' })}>
                      Mark filed
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[1.4rem] border border-border bg-card p-7" data-testid="card-feedback">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <MessageSquareText size={22} className="text-accent" strokeWidth={1.4} />
              <p className="mt-5 font-journal text-2xl text-primary">Complaints &amp; suggestions book</p>
              <p className="mt-2 max-w-[620px] text-xs leading-5 text-muted-foreground">
                What guests wrote at <span className="font-mono-ui text-primary">rajkuthirhomestays.casa/feedback</span> (the QR on the notice
                board). Note what you did and mark it resolved; the CSV is the book to show an inspector.
              </p>
            </div>
            <a href="/api/admin/feedback.csv" className={PILL} data-testid="link-feedback-csv">
              <Download size={13} /> Book (CSV)
            </a>
          </div>
          {open.length > 0 && <p className="mt-5 text-sm font-semibold text-[#A65E45]">{open.length} open</p>}
          {feedback.data && feedback.data.entries.length === 0 && <p className="mt-5 text-sm text-muted-foreground">Nothing in the book yet.</p>}
          <div className="mt-5 space-y-4">
            {(feedback.data?.entries ?? []).map((entry) => (
              <article key={entry.id} id={`feedback-${entry.id}`} className={`rounded-xl border p-5 ${entry.status === 'open' ? 'border-[#A65E45]/40' : 'border-border'}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full bg-muted px-3 py-1 text-[10px] font-bold uppercase tracking-[.08em] text-primary">{entry.kind}</span>
                  <p className="text-sm font-semibold text-primary">{entry.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {pretty(entry.createdAt)}
                    {entry.contact ? ` · ${entry.contact}` : ''}
                    {entry.stayRef ? ` · ${entry.stayRef}` : ''}
                  </p>
                </div>
                <p className="mt-3 whitespace-pre-line text-sm leading-6 text-foreground">{entry.message}</p>
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <input
                    id={`feedback-note-${entry.id}`}
                    value={notes[entry.id] ?? entry.ownerNote ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [entry.id]: e.target.value }))}
                    placeholder="What was done"
                    className="min-w-[220px] flex-1 border-b border-border bg-transparent py-1 text-sm outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    className={PILL}
                    onClick={() => resolve.mutate({ id: entry.id, resolved: entry.status === 'open', note: notes[entry.id] ?? entry.ownerNote ?? '' })}
                  >
                    {entry.status === 'open' ? 'Mark resolved' : 'Reopen'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
