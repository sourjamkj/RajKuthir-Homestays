import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';

import { adminFetch, useAdminSession } from '@/lib/admin-api';
import { AdminHeader } from '@/components/AdminHeader';
import { AdminAutoSend } from '@/components/AdminAutoSend';
import { manualWhatsappLink, type OutboxMessage, type SettingsView, type WhatsappMode } from '@workspace/admin-client';

/**
 * Everything WhatsApp in one place: is sending working, every message the
 * site sends (with approve / cancel), which kinds go out by themselves, the
 * Meta templates in use, and which Railway variables are set. Secret values
 * are never shown — only whether they are set.
 */

type Outbox = { configured: boolean; enabled: boolean; mode: WhatsappMode; messages: OutboxMessage[] };

const OUTBOX_KEY = ['/api/notifications'];
const SETTINGS_KEY = ['/api/admin/settings'];
const GROUPS = ['WhatsApp', 'WhatsApp agent', 'Caretaker alerts'];

const KIND: Record<string, string> = {
  booking_confirmed: 'Confirmation PDF',
  checkin_reminder: 'Arrival reminder',
  checkin_welcome: 'Check-in welcome',
  checkout_today: 'Checkout reminder',
  review_request: 'Review request',
  verification_reminder: 'ID verification reminder',
  owner_new_booking: 'New booking alert (to you)',
};

const STATUS: Record<OutboxMessage['status'], string> = {
  draft: 'Waiting for you',
  pending: 'Scheduled',
  sent: 'Sent',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** The Meta templates the site sends, for reference. Approval is checked in WhatsApp Manager. */
const TEMPLATES: { name: string; use: string }[] = [
  { name: 'rk_payment_received_id', use: 'Website payment received: booking confirmed + Upload ID button (immediately, any hour)' },
  { name: 'rk_verification_reminder', use: 'ID still pending: every 24 hours until the day before check-in' },
  { name: 'rk_booking_confirmation_pdf', use: 'Confirmation PDF with house rules, once the ID is verified' },
  { name: 'rk_checkin_reminder', use: 'Day before check-in, 10 am (after verification)' },
  { name: 'rk_checkin_welcome', use: 'Check-in day, 12 noon, with the Wi-Fi poster and house rules PDF' },
  { name: 'rk_checkout_today / rk_checkout_deposit', use: 'Check-out day, 10 am (deposit wording once WHATSAPP_CHECKOUT_TEMPLATE is set)' },
  { name: 'rk_review_general / rk_review_pet / rk_review_short', use: 'Review ask 2 pm on check-out day, one reminder 6 pm next day' },
  { name: 'rk_owner_new_booking', use: 'Every new booking, to your own WhatsApp' },
  { name: 'rk_caretaker_alert', use: 'Caretaker alerts (once WHATSAPP_CARETAKER_TEMPLATE is set)' },
  { name: 'rk_enquiry_quote / rk_dates_available', use: 'Enquiry quote; dates free again' },
  { name: 'rk_invoice / rk_arrival_pack', use: 'Invoice and arrival pack sent from the console' },
];

const BTN = 'inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-[.08em] disabled:opacity-40';
const BTN_PRIMARY = `${BTN} bg-primary text-primary-foreground`;
const BTN_OUTLINE = `${BTN} border border-border text-primary hover:border-primary`;

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso))
    : '—';

type Filter = 'waiting' | 'scheduled' | 'sent' | 'all';
const FILTERS: { key: Filter; label: string; match: (m: OutboxMessage) => boolean }[] = [
  { key: 'waiting', label: 'Needs you', match: (m) => m.status === 'draft' || m.status === 'failed' },
  { key: 'scheduled', label: 'Scheduled', match: (m) => m.status === 'pending' },
  { key: 'sent', label: 'Sent', match: (m) => m.status === 'sent' },
  { key: 'all', label: 'All', match: () => true },
];

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="font-serif text-2xl text-primary">{title}</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function AdminWhatsApp() {
  const [, navigate] = useLocation();
  const session = useAdminSession();
  const signedIn = session.data?.signedIn === true;
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('waiting');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (session.isSuccess && !signedIn) navigate('/admin/login', { replace: true });
  }, [session.isSuccess, signedIn, navigate]);

  const outbox = useQuery({ queryKey: OUTBOX_KEY, queryFn: () => adminFetch<Outbox>('/api/notifications'), enabled: signedIn, refetchInterval: 60_000 });
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => adminFetch<SettingsView>('/api/admin/settings'), enabled: signedIn });

  const act = useMutation({
    mutationFn: async (input: { path: string; done: string }) => {
      await adminFetch(input.path, { method: 'POST', body: '{}' });
      return input.done;
    },
    onSuccess: (done) => {
      setMessage(done);
      void queryClient.invalidateQueries({ queryKey: OUTBOX_KEY });
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

  const o = outbox.data;
  const w = settings.data?.whatsapp;
  const manual = o?.mode === 'manual';
  const shown = (o?.messages ?? []).filter(FILTERS.find((f) => f.key === filter)!.match);
  const variables = (settings.data?.railway ?? []).filter((v) => GROUPS.includes(v.group));

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <AdminHeader eyebrow="Guests" title="WhatsApp" />
      <main className="mx-auto max-w-[1180px] space-y-10 px-5 py-8 md:px-8 md:py-10">
        {message && (
          <p className="flex items-start justify-between gap-3 rounded-xl bg-secondary p-3 text-[13px] text-primary" role="status">
            {message}
            <button type="button" className="text-muted-foreground" onClick={() => setMessage(null)} aria-label="Dismiss">✕</button>
          </p>
        )}

        <Section title="Status" description="Whether the site can send WhatsApp messages from the business number right now.">
          <div className="grid gap-3 rounded-2xl border border-border bg-card p-5 text-sm md:grid-cols-3" data-testid="card-whatsapp-status">
            <p><span className="block text-xs font-bold uppercase tracking-[.08em] text-muted-foreground">Mode</span>{manual ? 'Manual (your own WhatsApp)' : 'Business API (automatic)'}</p>
            <p><span className="block text-xs font-bold uppercase tracking-[.08em] text-muted-foreground">API credentials</span>{o?.configured ? 'Set' : 'Missing'}</p>
            <p><span className="block text-xs font-bold uppercase tracking-[.08em] text-muted-foreground">Sending</span>{o?.enabled ? 'On' : 'Off'}</p>
            {w && !w.readiness.ready && (
              <p className="text-[#A65E45] md:col-span-3">Not ready: {w.readiness.missing.join(', ')}</p>
            )}
            {w?.readiness.warnings.map((warning) => (
              <p key={warning} className="text-[13px] text-muted-foreground md:col-span-3">{warning}</p>
            ))}
          </div>
        </Section>

        <Section title="Messages" description="Every guest and owner message the site sends, newest first. Failed and waiting messages can be sent from here.">
          <div className="mb-4 flex flex-wrap gap-2" role="tablist">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                className={filter === f.key ? BTN_PRIMARY : BTN_OUTLINE}
                onClick={() => setFilter(f.key)}
              >
                {f.label} · {(o?.messages ?? []).filter(f.match).length}
              </button>
            ))}
          </div>
          {outbox.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {o && shown.length === 0 && <p className="text-sm text-muted-foreground">Nothing here.</p>}
          <ul className="grid gap-3">
            {shown.map((m) => (
              <li key={m.id} className={`rounded-2xl border p-4 ${m.status === 'failed' ? 'border-[#A65E45]/40 bg-[#A65E45]/5' : 'border-border bg-card'}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-bold text-primary">{KIND[m.kind] ?? m.kind}</p>
                  <p className="text-xs text-muted-foreground">
                    {STATUS[m.status]} · {m.status === 'sent' ? `sent ${when(m.sentAt)}` : `due ${when(m.sendAfter)}`} · to {m.toPhone}
                  </p>
                </div>
                {m.error && m.status !== 'sent' && <p className="mt-1 text-[13px] text-[#A65E45]">{m.error}</p>}
                <details className="mt-2 text-[13px]">
                  <summary className="cursor-pointer text-muted-foreground">Preview message</summary>
                  <p className="mt-2 whitespace-pre-wrap">{m.preview}</p>
                </details>
                {m.status === 'sent' && !manual && (
                  <div className="mt-3">
                    <button type="button" className={BTN_OUTLINE} disabled={act.isPending} onClick={() => act.mutate({ path: `/api/notifications/${m.id}/approve`, done: 'Sending it again now.' })}>
                      Resend
                    </button>
                  </div>
                )}
                {(m.status === 'draft' || m.status === 'failed') && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {manual ? (
                      <a className={BTN_PRIMARY} href={manualWhatsappLink(m.toPhone, m.preview)} target="_blank" rel="noreferrer">Open in WhatsApp</a>
                    ) : (
                      <button type="button" className={BTN_PRIMARY} disabled={act.isPending} onClick={() => act.mutate({ path: `/api/notifications/${m.id}/approve`, done: 'Sending now (guest messages wait until 8 am during 11 pm–8 am).' })}>
                        {m.status === 'failed' ? 'Retry' : 'Approve and send'}
                      </button>
                    )}
                    <button type="button" className={BTN_OUTLINE} disabled={act.isPending} onClick={() => act.mutate({ path: `/api/notifications/${m.id}/cancel`, done: 'Cancelled.' })}>
                      Cancel
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Messages that send themselves" description="Ticked kinds go out without waiting for you. Changing this asks for your admin password.">
          <AdminAutoSend />
        </Section>

        <Section title="Templates" description="The Meta-approved templates the site uses. Check their approval in WhatsApp Manager → Message templates.">
          <ul className="grid gap-2 rounded-2xl border border-border bg-card p-5 text-[13px]">
            {TEMPLATES.map((t) => (
              <li key={t.name} className="grid gap-1 md:grid-cols-[minmax(0,320px)_1fr] md:gap-4">
                <code className="break-all text-primary">{t.name}</code>
                <span className="text-muted-foreground">{t.use}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Variables and tokens" description="Railway variables for WhatsApp. Secret values are never shown here — only whether they are set. Change them in Railway → @workspace/api-server → Variables.">
          <ul className="grid gap-2 rounded-2xl border border-border bg-card p-5 text-[13px]" data-testid="list-whatsapp-variables">
            {variables.map((v) => (
              <li key={v.name} className="flex flex-wrap items-center gap-2">
                {v.set ? <CheckCircle2 size={15} className="text-primary" aria-label="Set" /> : <XCircle size={15} className="text-[#A65E45]" aria-label="Not set" />}
                <code className="text-primary">{v.name}</code>
                <span className="text-muted-foreground">{v.value ?? (v.set ? 'set' : 'not set')}</span>
              </li>
            ))}
          </ul>
        </Section>
      </main>
    </div>
  );
}
