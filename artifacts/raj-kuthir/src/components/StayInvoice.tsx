import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, Loader2, Mail, Share2 } from 'lucide-react';

import { adminFetch } from '@/lib/admin-api';

/**
 * The invoice line on a stay in Guests: its number and what the automatic
 * check-out email is doing, plus Download, Email and "Paid in full".
 */

export type InvoiceStatus = {
  number: string | null;
  emailedAt: string | null;
  emailTo: string | null;
  email: string | null;
  autoStatus: string;
  needsAction: boolean;
  canInvoice: boolean;
  problem: string | null;
  otaDocuments: Array<{ id: string; kind: 'voucher' | 'cancellation' | 'statement' | 'other'; filename: string; createdAt: string }>;
};

const KIND_LABEL: Record<string, string> = { voucher: 'OTA voucher', cancellation: 'Cancellation', statement: 'Statement', other: 'OTA document' };

/**
 * Shares a PDF through the phone's share sheet — WhatsApp included — with
 * the file attached. Where the browser cannot share files (most desktops),
 * opens it instead so it can be saved and attached by hand.
 */
export async function sharePdf(url: string, filename: string): Promise<'shared' | 'opened'> {
  try {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error('fetch failed');
    const file = new File([await response.blob()], filename, { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'shared';
  }
  window.open(url, '_blank', 'noopener');
  return 'opened';
}

export const INVOICES_KEY = ['/api/admin/invoices'];

export function useInvoiceStatuses(bookingIds: string[]) {
  return useQuery({
    queryKey: [...INVOICES_KEY, bookingIds.join(',')],
    queryFn: () => adminFetch<{ invoices: Record<string, InvoiceStatus> }>(`/api/admin/invoices?ids=${bookingIds.join(',')}`),
    enabled: bookingIds.length > 0,
    staleTime: 30_000,
  });
}

const PILL =
  'inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.07em] text-primary transition-colors hover:border-primary disabled:opacity-40';

export function StayInvoice({ bookingId, status }: { bookingId: string; status: InvoiceStatus | undefined }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [asking, setAsking] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: INVOICES_KEY });
    void queryClient.invalidateQueries({ queryKey: ['/api/admin/guest-stays'] });
  };

  const email = useMutation({
    mutationFn: () =>
      adminFetch<{ to: string }>(`/api/admin/bookings/${bookingId}/invoice/email`, {
        method: 'POST',
        body: JSON.stringify(to.trim() ? { to: to.trim() } : {}),
      }),
    onSuccess: (data) => {
      setMessage(`Invoice emailed to ${data.to}.`);
      setAsking(false);
      refresh();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not email the invoice.'),
  });

  const paid = useMutation({
    mutationFn: () =>
      adminFetch<{ emailed: string | null; note?: string }>(`/api/admin/bookings/${bookingId}/paid-in-full`, { method: 'POST', body: '{}' }),
    onSuccess: (data) => {
      setMessage(data.emailed ? `Marked paid in full and invoice emailed to ${data.emailed}.` : `Marked paid in full. ${data.note ?? ''}`);
      refresh();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not update.'),
  });

  if (!status) return null;

  return (
    <div className="mt-2 text-[11px] text-muted-foreground" data-testid={`invoice-${bookingId}`}>
      <p className={status.needsAction ? 'text-[#8a6320]' : undefined}>
        <span className="font-bold text-primary">Invoice</span>
        {status.number ? ` ${status.number}` : ''} · {status.canInvoice ? status.autoStatus : status.problem}
      </p>
      {status.otaDocuments.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {status.otaDocuments.map((doc) => (
            <span key={doc.id} className="inline-flex items-center gap-1">
              <a href={`/api/admin/ota-documents/${doc.id}`} target="_blank" rel="noreferrer" className={PILL} title={doc.filename}>
                <FileText size={11} /> {KIND_LABEL[doc.kind] ?? 'OTA document'}
              </a>
              <button type="button" className={PILL} aria-label={`Share ${doc.filename}`} onClick={() => void sharePdf(`/api/admin/ota-documents/${doc.id}`, doc.filename)}>
                <Share2 size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      {status.canInvoice && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <a href={`/api/admin/bookings/${bookingId}/invoice.pdf`} target="_blank" rel="noreferrer" className={PILL} onClick={() => setTimeout(refresh, 1500)}>
            <FileText size={11} /> Our invoice
          </a>
          <button
            type="button"
            className={PILL}
            aria-label="Share our invoice"
            onClick={() => {
              void sharePdf(`/api/admin/bookings/${bookingId}/invoice.pdf`, `Invoice-${(status.number ?? 'Raj-Kuthir').replace(/\//g, '-')}.pdf`).then(refresh);
            }}
          >
            <Share2 size={11} />
          </button>
          <button type="button" className={PILL} onClick={() => (status.email && !asking ? email.mutate() : setAsking((value) => !value))} disabled={email.isPending}>
            {email.isPending ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />} Email{status.emailedAt ? ' again' : ''}
          </button>
          {status.autoStatus.startsWith('Balance not recorded') && (
            <button type="button" className={PILL} onClick={() => paid.mutate()} disabled={paid.isPending}>
              {paid.isPending ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Paid in full
            </button>
          )}
        </div>
      )}
      {asking && (
        <form
          className="mt-1.5 flex flex-wrap items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            email.mutate();
          }}
        >
          <input
            id={`invoice-to-${bookingId}`}
            type="email"
            required
            value={to}
            onChange={(event) => setTo(event.target.value)}
            placeholder={status.email ?? 'guest@email.com'}
            className="rounded-full border border-border bg-background px-3 py-1 text-[11px] text-primary"
          />
          <button type="submit" className={PILL} disabled={email.isPending}>Send</button>
        </form>
      )}
      {message && <p className="mt-1 text-primary" role="status">{message}</p>}
    </div>
  );
}
