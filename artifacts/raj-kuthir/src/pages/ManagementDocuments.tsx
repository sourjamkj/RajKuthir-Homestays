import { useEffect, useState, type ReactNode } from 'react';
import { useRoute } from 'wouter';
import { AlertCircle, CheckCircle2, ExternalLink, FileText, Loader2 } from 'lucide-react';

type DocumentItem = {
  id: string;
  documentType: string;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  status: 'pending' | 'submitted' | 'verified' | 'rejected';
  rejectionReason: string | null;
  uploadedAt: string;
};

type ManagementData = {
  booking: { guestName: string | null; guestPhone: string | null; checkIn: string; checkOut: string };
  documents: DocumentItem[];
};

export default function ManagementDocuments() {
  const [, params] = useRoute('/management-documents/:token');
  const token = params?.token ?? '';
  const [data, setData] = useState<ManagementData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Guest document access | Sobuj Potro';
    fetch('/api/management/documents/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'This access link is unavailable.');
        return body as ManagementData;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'This access link is unavailable.'));
  }, [token]);

  if (error) return <Shell><div className="max-w-[720px] rounded-2xl border border-border bg-card p-7"><AlertCircle className="text-accent"/><h1 className="mt-4 font-journal text-3xl text-primary">Document access unavailable</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">{error}</p></div></Shell>;
  if (!data) return <Shell><Loader2 className="animate-spin text-primary"/></Shell>;

  const ready = data.documents.length > 0 && data.documents.every((document) => document.status === 'verified');
  const openDocument = async (documentId: string) => {
    setOpening(documentId);
    try {
      const response = await fetch('/api/management/documents/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, documentId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? 'Could not open this document.');
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open this document.');
    } finally {
      setOpening(null);
    }
  };
  return <Shell>
    <div className="max-w-[820px]">
      <p className="eyebrow text-accent">Sobuj Potro management</p>
      <h1 className="mt-4 font-journal text-[clamp(2.6rem,6vw,4.4rem)] leading-[.95] text-primary">Guest <em className="text-accent">verification.</em></h1>
      <p className="mt-5 text-sm leading-7 text-muted-foreground">Secure access to the identity documents uploaded for this stay. This page contains operational guest-verification information only.</p>

      <div className="mt-7 rounded-2xl border border-border bg-card p-5 text-sm">
        <p className="font-medium text-primary">{data.booking.guestName ?? 'Guest'}</p>
        <p className="mt-1 text-muted-foreground">{data.booking.guestPhone ?? 'No mobile number'} · {data.booking.checkIn} → {data.booking.checkOut}</p>
        <div className="mt-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[.08em]">
          {ready ? <><CheckCircle2 size={15} className="text-[#4b5340]"/> Verification complete</> : <><AlertCircle size={15} className="text-[#A65E45]"/> Verification pending</>}
        </div>
      </div>

      <section className="mt-7 rounded-2xl border border-border bg-card p-5">
        <p className="eyebrow text-muted-foreground">Guest ID documents</p>
        {data.documents.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No documents have been uploaded yet.</p> : <div className="mt-4 space-y-3">
          {data.documents.map((document) => (
            <div key={document.id} className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
              <div className="flex min-w-0 items-center gap-3"><FileText size={17} className="shrink-0 text-accent"/><div className="min-w-0"><p className="truncate text-sm font-medium text-primary">{document.documentType}</p><p className="truncate text-xs text-muted-foreground">{document.originalFilename ?? 'Uploaded document'}</p></div></div>
              <div className="flex shrink-0 items-center gap-3"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.07em] ${document.status === 'verified' ? 'border-[#7A8065]/40 bg-[#7A8065]/10 text-[#4b5340]' : document.status === 'rejected' ? 'border-[#A65E45]/40 bg-[#A65E45]/10 text-[#A65E45]' : 'border-border text-muted-foreground'}`}>{document.status}</span><button type="button" onClick={() => openDocument(document.id)} disabled={opening === document.id} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-[.07em] text-primary hover:border-primary disabled:opacity-50"><ExternalLink size={12}/> {opening === document.id ? 'Opening…' : 'Open'}</button></div>
            </div>
          ))}
        </div>}
      </section>
    </div>
  </Shell>;
}

function Shell({ children }: { children: ReactNode }) { return <div className="min-h-[100dvh] bg-background text-foreground"><header className="border-b border-foreground/10"><div className="mx-auto max-w-[1180px] px-5 py-5"><span className="font-mono-ui text-[10px] tracking-[.18em] text-muted-foreground">RAJ KUTHIR HOMESTAYS</span><span className="ml-2 font-journal text-xl text-primary">Sobuj Potro</span></div></header><main className="mx-auto max-w-[1180px] px-5 py-12 md:py-20">{children}</main></div>; }
