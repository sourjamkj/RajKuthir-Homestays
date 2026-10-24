import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Image as ImageIcon, Loader2, MessageCircle, Settings2, Wallet, X } from 'lucide-react';

import { AdminApiError, adminFetch } from '@/lib/admin-api';
import { formatRupees } from '@/lib/rates';

/**
 * "Payments to verify" — the owner's half of Book & Pay.
 *
 * Confirm runs advance-received and convert on the server (the same code as
 * the buttons on an enquiry), so the booking it creates is no different from
 * any other converted enquiry. Reject releases the dates and keeps a reason.
 */

export const BOOK_PAY_KEY = ['/api/admin/book-pay'];

type Row = {
  id: string;
  enquiryId: string;
  bookingId: string | null;
  reference: string;
  status: 'awaiting_payment' | 'submitted' | 'confirmed' | 'rejected' | 'expired';
  guestName: string;
  guestPhone: string;
  guestEmail: string | null;
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
  decidedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
  overdue: boolean;
  rebookWhatsappUrl: string | null;
};

type Response = {
  settings: { advancePercent: number; holdMinutes: number };
  upiReady: boolean;
  payments: Row[];
  migrationNeeded?: boolean;
};

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso))
    : '—';

const day = (iso: string | null) => {
  if (!iso) return '?';
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y!, m! - 1, d!)));
};

const STATUS_LABEL: Record<Row['status'], string> = {
  awaiting_payment: 'Waiting for payment',
  submitted: 'To verify',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  expired: 'Expired',
};

export function AdminBookPay() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: BOOK_PAY_KEY,
    queryFn: () => adminFetch<Response>('/api/admin/book-pay'),
    refetchInterval: 60_000,
  });
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState<{ advancePercent: string; holdMinutes: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: BOOK_PAY_KEY });
    void queryClient.invalidateQueries({ queryKey: ['/api/enquiries'] });
  };

  // The WhatsApp message stays on screen as a link, so a blocked pop-up
  // never leaves the owner with nothing to send.
  const [sendLink, setSendLink] = useState<{ url: string; preview: string } | null>(null);

  type ConfirmResult = { whatsappUrl: string | null; emailed: boolean; preview: string; booking: { reference: string } };
  const postConfirm = (row: Row, force: boolean) =>
    adminFetch<ConfirmResult>(`/api/admin/book-pay/${row.id}/confirm`, {
      method: 'POST',
      body: JSON.stringify(force ? { force: true } : {}),
    });

  const confirm = useMutation({
    mutationFn: async (row: Row) => {
      setSendLink(null);
      let result: ConfirmResult;
      try {
        result = await postConfirm(row, false);
      } catch (error) {
        const clash = error instanceof AdminApiError && error.status === 409 && /double booking/i.test(error.message);
        if (!clash) throw error;
        if (!window.confirm(`${error.message}\n\nIf that block is this same guest (or you are sure there is no double booking), press OK to confirm anyway.`)) {
          throw new Error('Not confirmed. Check the calendar first.');
        }
        result = await postConfirm(row, true);
      }
      if (result.whatsappUrl) {
        setSendLink({ url: result.whatsappUrl, preview: result.preview });
        window.open(result.whatsappUrl, '_blank');
      }
      setMessage(
        `${row.status === 'confirmed' ? 'Confirmation ready again for' : 'Confirmed'} ${result.booking.reference}.` +
          (result.emailed ? ' Confirmation emailed to the guest.' : '') +
          (result.whatsappUrl ? ' Tap "Send confirmation on WhatsApp" below if WhatsApp did not open.' : ' No WhatsApp number on file — copy the message below.'),
      );
      if (!result.whatsappUrl) setSendLink({ url: '', preview: result.preview });
    },
    onSuccess: refresh,
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not confirm.'),
  });

  const reject = useMutation({
    mutationFn: (row: Row) =>
      adminFetch(`/api/admin/book-pay/${row.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: reasons[row.id] ?? '' }),
      }),
    onSuccess: () => {
      setMessage('Rejected. The dates are free again.');
      refresh();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not reject.'),
  });

  const notified = useMutation({
    mutationFn: (row: Row) => adminFetch(`/api/admin/book-pay/${row.id}/expiry-notified`, { method: 'POST', body: '{}' }),
    onSuccess: refresh,
  });

  const saveSettings = useMutation({
    mutationFn: (values: { advancePercent: number; holdMinutes: number }) =>
      adminFetch('/api/admin/book-pay/settings', { method: 'PUT', body: JSON.stringify(values) }),
    onSuccess: () => {
      setShowSettings(false);
      setMessage('Book & Pay settings saved.');
      refresh();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not save.'),
  });

  const data = query.data;
  const rows = data?.payments ?? [];
  const toVerify = rows.filter((row) => row.status === 'submitted');
  const waiting = rows.filter((row) => row.status === 'awaiting_payment');
  const recent = rows.filter((row) => !['submitted', 'awaiting_payment'].includes(row.status));

  const card = (row: Row) => (
    <li key={row.id} id={`payment-${row.id}`} className="rounded-2xl border border-border bg-card p-4" data-testid={`row-payment-${row.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-bold text-primary">{row.guestName} <span className="font-normal text-muted-foreground">· {row.guestPhone}</span></p>
          <p className="text-[13px] text-primary/80">
            {day(row.checkIn)} → {day(row.checkOut)} · {row.guests} guest{row.guests === 1 ? '' : 's'}{row.pets ? ` · ${row.pets} pet` : ''} · <span className="font-mono">{row.reference}</span>
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[.08em] ${row.status === 'submitted' ? (row.overdue ? 'bg-[#A65E45] text-white' : 'bg-accent text-white') : row.status === 'confirmed' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-primary'}`}>
          {row.overdue ? 'Overdue — decide' : STATUS_LABEL[row.status]}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] tabular-nums sm:grid-cols-4">
        <div><dt className="text-[10px] uppercase tracking-[.08em] text-muted-foreground">Advance</dt><dd className="font-bold text-primary">{formatRupees(row.advancePaise)}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-[.08em] text-muted-foreground">UTR</dt><dd className="font-mono text-primary">{row.utr ?? '—'}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-[.08em] text-muted-foreground">Submitted</dt><dd className="text-primary">{when(row.utrSubmittedAt)}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-[.08em] text-muted-foreground">{row.status === 'submitted' ? 'Decide by' : 'Hold until'}</dt><dd className="text-primary">{when(row.holdExpiresAt)}</dd></div>
      </dl>

      {row.hasScreenshot && (
        <a href={`/api/admin/book-pay/${row.id}/screenshot`} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-bold text-accent underline underline-offset-2">
          <ImageIcon size={13} /> View payment screenshot
        </a>
      )}
      {row.rejectReason && <p className="mt-2 text-[12px] text-muted-foreground">Reason: {row.rejectReason}</p>}

      {(row.status === 'submitted' || row.status === 'awaiting_payment' || row.status === 'expired') && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            disabled={confirm.isPending}
            onClick={() => {
              if (row.status === 'awaiting_payment' && !window.confirm('No UTR yet. Confirm only if you have seen this money in your bank.')) return;
              if (row.status === 'expired' && !window.confirm('This hold had expired. Confirm only if you have seen this money in your bank — the dates will be booked if they are still free.')) return;
              confirm.mutate(row);
            }}
            className="flex items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[11px] font-bold uppercase tracking-[.08em] text-primary-foreground disabled:opacity-40"
            data-testid="button-payment-confirm"
          >
            {confirm.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Confirm — money received
          </button>
          <input
            id={`reject-reason-${row.id}`}
            value={reasons[row.id] ?? ''}
            onChange={(event) => setReasons({ ...reasons, [row.id]: event.target.value })}
            placeholder="Reason, if rejecting (e.g. UTR not in bank)"
            className="flex-1 rounded-full border border-border bg-background px-4 py-2 text-[12px] outline-none focus:border-primary"
          />
          <button
            type="button"
            disabled={reject.isPending || !(reasons[row.id] ?? '').trim()}
            onClick={() => reject.mutate(row)}
            className="flex items-center justify-center gap-1.5 rounded-full border border-[#A65E45]/50 px-4 py-2 text-[11px] font-bold uppercase tracking-[.08em] text-[#A65E45] disabled:opacity-40"
            data-testid="button-payment-reject"
          >
            <X size={13} /> Reject
          </button>
        </div>
      )}

      {row.status === 'confirmed' && (
        <button
          type="button"
          disabled={confirm.isPending}
          onClick={() => confirm.mutate(row)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary/25 px-4 py-2 text-[11px] font-bold uppercase tracking-[.08em] text-primary disabled:opacity-40"
          data-testid="button-payment-resend"
        >
          <MessageCircle size={13} /> Send confirmation to guest again
        </button>
      )}

      {row.rebookWhatsappUrl && (
        <a
          href={row.rebookWhatsappUrl}
          target="_blank"
          rel="noreferrer"
          onClick={() => notified.mutate(row)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary/25 px-4 py-2 text-[11px] font-bold uppercase tracking-[.08em] text-primary"
        >
          <MessageCircle size={13} /> Send "hold expired, rebook here"
        </a>
      )}
    </li>
  );

  return (
    <section id="payments" className="scroll-mt-6" aria-label="Payments to verify">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow flex items-center gap-2 text-accent"><Wallet size={15} /> Book &amp; Pay</p>
          <h2 className="mt-1 font-journal text-3xl text-primary">Payments to verify{toVerify.length ? ` · ${toVerify.length}` : ''}</h2>
          <p className="mt-1 max-w-[620px] text-[13px] text-muted-foreground">
            Guests who booked online and say they paid. Find the UTR in your bank app, then confirm or reject. Dates stay held until you decide.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setDraft({ advancePercent: String(data?.settings.advancePercent ?? 50), holdMinutes: String(data?.settings.holdMinutes ?? 30) });
            setShowSettings((value) => !value);
          }}
          className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-[.08em] text-primary"
        >
          <Settings2 size={13} /> Settings
        </button>
      </div>

      {data?.migrationNeeded && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-[#A65E45]/40 bg-[#A65E45]/5 p-3 text-[13px] text-[#A65E45]">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> The Book &amp; Pay tables are not in the database yet. Run artifacts/api-server/src/db/book-and-pay.sql in Railway.
        </p>
      )}
      {data && !data.upiReady && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-[#A65E45]/40 bg-[#A65E45]/5 p-3 text-[13px] text-[#A65E45]">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> RAJ_KUTHIR_UPI_ID and RAJ_KUTHIR_UPI_NAME are not set, so guests cannot pay online yet.
        </p>
      )}

      {showSettings && draft && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            saveSettings.mutate({ advancePercent: Number(draft.advancePercent), holdMinutes: Number(draft.holdMinutes) });
          }}
          className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4"
        >
          <label className="text-[12px] text-muted-foreground">
            Advance %
            <input id="bookpay-advance" type="number" min={10} max={100} value={draft.advancePercent} onChange={(e) => setDraft({ ...draft, advancePercent: e.target.value })} className="mt-1 block w-24 rounded-lg border border-border bg-background px-3 py-2 text-primary" />
          </label>
          <label className="text-[12px] text-muted-foreground">
            Hold (minutes)
            <input id="bookpay-hold" type="number" min={10} max={1440} value={draft.holdMinutes} onChange={(e) => setDraft({ ...draft, holdMinutes: e.target.value })} className="mt-1 block w-28 rounded-lg border border-border bg-background px-3 py-2 text-primary" />
          </label>
          <button type="submit" className="rounded-full bg-primary px-4 py-2 text-[11px] font-bold uppercase tracking-[.08em] text-primary-foreground">Save</button>
          <p className="w-full text-[11px] text-muted-foreground">Applies to new bookings. A hold stretches to 12 hours once the guest submits a UTR.</p>
        </form>
      )}

      {message && <p className="mt-4 rounded-xl bg-secondary p-3 text-[13px] text-primary" role="status">{message}</p>}
      {sendLink && (
        <div className="mt-3 rounded-2xl border border-primary/25 bg-card p-4">
          {sendLink.url && (
            <a
              href={sendLink.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[11px] font-bold uppercase tracking-[.08em] text-primary-foreground"
              data-testid="link-payment-whatsapp"
            >
              <MessageCircle size={13} /> Send confirmation on WhatsApp
            </a>
          )}
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(sendLink.preview).then(() => setMessage('Message copied.'))}
            className="ml-2 mt-2 inline-flex items-center rounded-full border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-[.08em] text-primary"
          >
            Copy message
          </button>
          <pre className="mt-3 whitespace-pre-wrap font-sans text-[12px] text-primary/80">{sendLink.preview}</pre>
        </div>
      )}

      {query.isLoading && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}
      {data && rows.length === 0 && !data.migrationNeeded && <p className="mt-4 text-sm text-muted-foreground">No online bookings yet.</p>}

      {toVerify.length > 0 && <ul className="mt-5 space-y-3">{toVerify.map(card)}</ul>}
      {waiting.length > 0 && (
        <>
          <p className="mt-6 text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground">Holding — guest paying now</p>
          <ul className="mt-2 space-y-3">{waiting.map(card)}</ul>
        </>
      )}
      {recent.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground">Last 14 days ({recent.length})</summary>
          <ul className="mt-2 space-y-3">{recent.map(card)}</ul>
        </details>
      )}
    </section>
  );
}
