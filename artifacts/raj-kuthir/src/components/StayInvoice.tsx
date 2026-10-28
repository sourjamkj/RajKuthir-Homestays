import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, Loader2, Mail } from 'lucide-react';

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
};

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
      {status.canInvoice && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <a href={`/api/admin/bookings/${bookingId}/invoice.pdf`} target="_blank" rel="noreferrer" className={PILL} onClick={() => setTimeout(refresh, 1500)}>
            <FileText size={11} /> PDF
          </a>
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
