import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, FileText, Loader2, ShieldCheck, Upload } from 'lucide-react';

/**
 * THE TOKEN LIVES IN THE URL FRAGMENT, NOT THE PATH.
 *
 * It is a bearer credential: whoever holds it can file this guest's identity
 * documents. In a path or query string it would be written verbatim into the
 * Railway proxy access log, sent to any third-party asset in a Referer header,
 * and kept in browser history — the same reasoning that keeps the booking
 * reference out of the /welcome URL (see the note in routes/guest.ts). A
 * fragment is never transmitted to any server: the browser holds it locally,
 * and it is exchanged for booking data over POST exactly as before.
 */
function tokenFromFragment(): string {
  if (typeof window === 'undefined') return '';
  return decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
}

type Lookup = {
  booking: { reference: string | null; guestName: string | null; guestPhone: string | null; checkIn: string; checkOut: string; guests: number | null; pets: number | null };
  verificationDeadline: string;
  deadlinePassed: boolean;
  status: string;
};

/*
 * The server requires a MIME type from its allowlist (PDF, JPEG, PNG, WebP)
 * and checks the bytes match it. Some phones hand over files with an empty
 * file.type, so fall back to the extension rather than send nothing.
 */
const DOCUMENT_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp';
const MIME_BY_EXTENSION: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
function documentMime(file: File): string {
  const declared = file.type.toLowerCase();
  if (Object.values(MIME_BY_EXTENSION).includes(declared)) return declared;
  if (declared) return '';
  return MIME_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? '';
}

type DocumentDraft = { documentType: string; documentNumber: string; originalFilename: string; mimeType: string; dataBase64: string };

export default function PreArrival() {
  const [token] = useState(tokenFromFragment);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [documents, setDocuments] = useState<DocumentDraft[]>([]);

  useEffect(() => {
    document.title = 'Pre-arrival verification | Raj Kuthir Homestays';
    document.querySelector('meta[name="robots"]')?.remove();
    const meta = document.createElement('meta'); meta.name = 'robots'; meta.content = 'noindex, nofollow'; document.head.appendChild(meta);

    // The fragment is deliberately left in the address bar rather than cleared
    // with replaceState: a guest whose upload fails will reload the page, and
    // clearing it would strand them on a link they cannot get back. It never
    // leaves their own browser, which is the exposure that mattered.
    if (!token) {
      setError('This verification link is incomplete. Please open the full link from your WhatsApp message.');
      return () => meta.remove();
    }

    fetch('/api/guest/onboarding/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      .then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error); return b as Lookup; })
      .then((data) => { setLookup(data); setName(data.booking.guestName ?? ''); setPhone(data.booking.guestPhone ?? ''); })
      .catch((e) => setError(e instanceof Error ? e.message : 'This link is unavailable.'));
    return () => meta.remove();
  }, [token]);

  const addDocument = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!documentMime(file)) { setError('Please upload a PDF, JPG, PNG or WebP file.'); event.target.value = ''; return; }
    if (file.size > 8 * 1024 * 1024) { setError('Each document must be 8 MB or smaller.'); return; }
    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(new Error('Could not read the document.'));
      reader.readAsDataURL(file);
    });
    setDocuments((current) => [...current, { documentType: 'Identity document', documentNumber: '', originalFilename: file.name, mimeType: documentMime(file), dataBase64 }]);
    event.target.value = '';
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!lookup || saving) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch('/api/guest/onboarding/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, fullName: name, phone, email, address, documents }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? 'Could not save your verification.');
      setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save your verification.'); }
    finally { setSaving(false); }
  };

  if (error && !lookup) return <Shell><div className="rounded-2xl border border-border bg-card p-7"><AlertCircle className="text-accent" /><h1 className="mt-4 font-journal text-3xl text-primary">Verification link unavailable</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">{error}</p></div></Shell>;
  if (!lookup) return <Shell><Loader2 className="animate-spin text-primary" /></Shell>;

  const deadline = new Date(lookup.verificationDeadline);
  const deadlinePassed = lookup.deadlinePassed || lookup.status === 'blocked';
  return <Shell>
    <div className="max-w-[720px]">
      <p className="eyebrow text-accent">Mandatory pre-arrival check-in</p>
      <h1 className="mt-4 font-journal text-[clamp(2.6rem,6vw,4.4rem)] leading-[.95] text-primary">Verify your <em className="text-accent">stay.</em></h1>
      <p className="mt-6 text-sm leading-7 text-muted-foreground">Please complete this form and upload the required identity document for your stay at Raj Kuthir Homestays – Sobuj Potro.</p>

      <div className="mt-7 rounded-2xl border border-[#A65E45]/40 bg-[#A65E45]/10 p-5">
        <div className="flex gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-[#A65E45]" size={20}/><div><p className="font-bold text-primary">Complete at least 48 hours before check-in</p><p className="mt-1 text-sm leading-6 text-muted-foreground">Deadline: <strong>{deadline.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}</strong>.</p><p className="mt-2 text-sm font-semibold text-[#A65E45]">{deadlinePassed ? 'The verification deadline has passed. Check-in is blocked until the property team reviews the booking.' : 'Failure to complete mandatory verification may result in check-in being denied without refund, in accordance with the booking terms.'}</p></div></div>
      </div>

      <div className="mt-7 rounded-2xl border border-border bg-card p-5 text-sm"><p className="font-medium text-primary">{lookup.booking.guestName ?? 'Guest'}</p><p className="mt-1 text-muted-foreground">{lookup.booking.checkIn} → {lookup.booking.checkOut} · {lookup.booking.guests ?? '—'} guests{lookup.booking.pets ? ` · ${lookup.booking.pets} pet${lookup.booking.pets === 1 ? '' : 's'}` : ''}</p></div>

      {deadlinePassed && !saved ? <div className="mt-7 rounded-2xl border border-[#A65E45]/40 bg-[#A65E45]/10 p-7"><AlertCircle className="text-[#A65E45]"/><h2 className="mt-4 font-journal text-3xl text-primary">Verification deadline passed.</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">The mandatory 48-hour verification window has closed. Please contact the property team; they will review your booking and advise you on the next step.</p></div> : saved ? <div className="mt-7 rounded-2xl border border-[#7A8065]/40 bg-[#7A8065]/10 p-7"><CheckCircle2 className="text-[#4b5340]"/><h2 className="mt-4 font-journal text-3xl text-primary">Verification submitted.</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Thank you. Your documents have been submitted for review. Please keep your phone available in case the property team needs clarification.</p></div> : <form onSubmit={submit} className="mt-7 space-y-6">
        <label className="block"><span className="eyebrow text-muted-foreground">Full name</span><input required value={name} onChange={e=>setName(e.target.value)} className="mt-2 w-full border-b border-border bg-transparent py-3 text-base outline-none focus:border-primary"/></label>
        <label className="block"><span className="eyebrow text-muted-foreground">Mobile number</span><input required type="tel" value={phone} onChange={e=>setPhone(e.target.value)} className="mt-2 w-full border-b border-border bg-transparent py-3 text-base outline-none focus:border-primary"/></label>
        <label className="block"><span className="eyebrow text-muted-foreground">Email (optional)</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-2 w-full border-b border-border bg-transparent py-3 text-base outline-none focus:border-primary"/></label>
        <label className="block"><span className="eyebrow text-muted-foreground">Address (optional)</span><textarea value={address} onChange={e=>setAddress(e.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-border bg-transparent p-3 text-sm outline-none focus:border-primary"/></label>
        <div className="rounded-2xl border border-border bg-card p-5"><p className="eyebrow text-muted-foreground">Identity documents</p><p className="mt-2 text-sm leading-6 text-muted-foreground">You can upload an issued identity document here. DigiLocker integration can be enabled when Raj Kuthir's approved API credentials are configured.</p><label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-5 text-xs font-bold uppercase tracking-[.08em] text-primary hover:border-primary"><Upload size={15}/> Add document<input type="file" accept={DOCUMENT_ACCEPT} className="hidden" onChange={addDocument}/></label>{documents.map((doc,i)=><div key={`${doc.originalFilename}-${i}`} className="mt-3 rounded-xl border border-border p-3"><div className="flex items-center gap-3"><FileText size={16} className="text-accent"/><div className="min-w-0"><p className="truncate text-sm font-medium">{doc.originalFilename}</p><input value={doc.documentType} onChange={e=>setDocuments(ds=>ds.map((d,j)=>j===i?{...d,documentType:e.target.value}:d))} className="mt-1 w-full border-b border-border bg-transparent py-1 text-xs outline-none" placeholder="Document type"/></div></div></div>)}</div>
        {error && <p className="text-sm text-[#A65E45]" role="alert">{error}</p>}
        <button disabled={saving || !documents.length} className="flex items-center gap-3 rounded-full bg-primary px-6 py-4 text-xs font-bold uppercase tracking-[.12em] text-primary-foreground disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin"/> : <CheckCircle2 size={15}/>} Submit verification</button>
      </form>}
    </div>
  </Shell>;
}

function Shell({ children }: { children: ReactNode }) { return <div className="min-h-[100dvh] bg-background text-foreground"><header className="border-b border-foreground/10"><div className="mx-auto max-w-[1180px] px-5 py-5"><span className="font-mono-ui text-[10px] tracking-[.18em] text-muted-foreground">RAJ KUTHIR HOMESTAYS</span><span className="ml-2 font-journal text-xl text-primary">Sobuj Potro</span></div></header><main className="mx-auto max-w-[1180px] px-5 py-12 md:py-20">{children}</main></div>; }
