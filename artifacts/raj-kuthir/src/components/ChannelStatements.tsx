import { useQuery } from '@tanstack/react-query';
import { FileText, Share2 } from 'lucide-react';

import { adminFetch } from '@/lib/admin-api';
import { sharePdf } from '@/components/StayInvoice';

/**
 * Monthly statements and other PDFs the OTAs emailed that are not about one
 * booking — MakeMyTrip's commission invoices, for instance. Filed by the
 * mail sync; open or share them from here.
 */

type Doc = { id: string; source: string; kind: string; period: string | null; filename: string; emailSubject: string | null; createdAt: string };

const SOURCE: Record<string, string> = { makeMyTrip: 'MakeMyTrip / Goibibo', bookingCom: 'Booking.com', airbnb: 'Airbnb' };

const month = (period: string | null, created: string) => {
  const iso = period ? `${period}-01` : created.slice(0, 10);
  const [y, m] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y!, m! - 1, 1)));
};

export function ChannelStatements() {
  const query = useQuery({
    queryKey: ['/api/admin/ota-documents'],
    queryFn: () => adminFetch<{ documents: Doc[] }>('/api/admin/ota-documents'),
  });
  const docs = query.data?.documents ?? [];

  return (
    <section className="mt-8" aria-label="Channel statements">
      <p className="text-[10px] font-bold uppercase tracking-[.14em] text-accent">From the OTAs</p>
      <h2 className="mt-1 font-journal text-2xl text-primary">Channel statements</h2>
      <p className="mt-1 max-w-[640px] text-[13px] text-muted-foreground">
        Commission invoices and other PDFs the channels email you, saved automatically from your connected mailbox.
        Booking vouchers appear on each stay in Guests.
      </p>
      {query.isLoading && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}
      {!query.isLoading && docs.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">Nothing yet. They appear here as the mailbox sync reads them.</p>
      )}
      {docs.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-2xl border border-border bg-card">
          {docs.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{SOURCE[doc.source] ?? doc.source} · {month(doc.period, doc.createdAt)}</p>
                <p className="text-[12px] text-muted-foreground">{doc.emailSubject ?? doc.filename}</p>
              </div>
              <div className="flex items-center gap-2">
                <a href={`/api/admin/ota-documents/${doc.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.07em] text-primary hover:border-primary">
                  <FileText size={11} /> Open
                </a>
                <button type="button" onClick={() => void sharePdf(`/api/admin/ota-documents/${doc.id}`, doc.filename)} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.07em] text-primary hover:border-primary" aria-label={`Share ${doc.filename}`}>
                  <Share2 size={11} /> Share
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
