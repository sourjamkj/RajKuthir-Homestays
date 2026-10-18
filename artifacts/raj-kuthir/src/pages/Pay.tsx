import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Clock, Copy, Loader2, Smartphone, Upload } from 'lucide-react';

import { formatRupees } from '@/lib/rates';
import { CONFIG, basePath, phoneHref } from '@/lib/site';

/**
 * /pay — the Book & Pay payment page.
 *
 * The token is in the URL FRAGMENT, exactly like /pre-arrival: a fragment is
 * never sent to a server, so it cannot land in an access log or a Referer
 * header. It is exchanged for the booking summary over POST.
 *
 * Nothing on this page says "confirmed" until the owner has confirmed. The
 * status line is written by the server (guestStatusText), not here.
 */

type PayData = {
  reference: string;
  status: 'awaiting_payment' | 'submitted' | 'confirmed' | 'rejected' | 'expired';
  statusText: string;
  guestFirstName: string;
  checkIn: string | null;
  checkOut: string | null;
  nights: number;
  guests: number;
  pets: number;
  totalPaise: number;
  advancePaise: number;
  balancePaise: number;
  advancePercent: number;
  holdExpiresAt: string;
  secondsLeft: number;
  utrSubmitted: boolean;
  payee: { upiId: string; name: string } | null;
  upiUrl: string | null;
  qrSvg: string | null;
};

function tokenFromFragment(): string {
  if (typeof window === 'undefined') return '';
  return decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
}

function pretty(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y!, m! - 1, d!)),
  );
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const isMobile = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function Pay() {
  const [token] = useState(tokenFromFragment);
  const [data, setData] = useState<PayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [utr, setUtr] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const mobile = isMobile();

  useEffect(() => {
    const previous = document.title;
    document.title = 'Complete your booking | Raj Kuthir Homestays';
    return () => {
      document.title = previous;
    };
  }, []);

  const load = useCallback(async () => {
    if (!token) {
      setError('This payment link is incomplete. Please open the link from the booking page again.');
      return;
    }
    try {
      const response = await fetch('/api/book/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? 'This payment link is not valid.');
        return;
      }
      setData(body as PayData);
      setLeft((body as PayData).secondsLeft);
      setError(null);
    } catch {
      setError('Could not reach the server. Please check your connection and refresh.');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Countdown, and a refresh the moment it reaches zero so the page shows
  // what the server now says rather than a stale "pay now".
  useEffect(() => {
    if (!data || data.status !== 'awaiting_payment' || left <= 0) return;
    const timer = window.setInterval(() => {
      setLeft((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          void load();
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [data, left > 0, load]); // eslint-disable-line react-hooks/exhaustive-deps

  // While the owner checks, look again every minute.
  useEffect(() => {
    if (data?.status !== 'submitted') return;
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [data?.status, load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const digits = utr.replace(/[\s-]/g, '');
    if (!/^\d{12}$/.test(digits)) {
      setFormError('The UPI transaction ID (UTR) is the 12-digit number in your UPI app’s payment details.');
      return;
    }
    if (file && file.size > 5 * 1024 * 1024) {
      setFormError('The screenshot is larger than 5 MB.');
      return;
    }
    setSending(true);
    try {
      const screenshot = file
        ? { mimeType: file.type || (/\.png$/i.test(file.name) ? 'image/png' : /\.webp$/i.test(file.name) ? 'image/webp' : 'image/jpeg'), dataBase64: await readAsBase64(file) }
        : undefined;
      const response = await fetch('/api/book/pay/utr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, utr: digits, screenshot }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFormError(body.error ?? 'Could not save that. Please try again.');
        return;
      }
      await load();
    } catch {
      setFormError('Could not reach the server. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const copyUpi = async () => {
    if (!data?.payee) return;
    try {
      await navigator.clipboard.writeText(data.payee.upiId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the ID is on screen to type */
    }
  };

  const payable = data?.status === 'awaiting_payment' && left > 0 && data.upiUrl;

  return (
    <div className="min-h-[100dvh] bg-background px-4 py-10 text-foreground">
      <main className="mx-auto max-w-[560px]">
        <a href={`${basePath}/`} className="eyebrow text-accent">Raj Kuthir Homestays – Sobuj Potro</a>
        <h1 className="mt-3 font-journal text-4xl leading-tight text-primary">Complete your booking</h1>

        {error && (
          <p className="mt-6 flex items-start gap-2 rounded-xl border border-[#A65E45]/40 bg-[#A65E45]/5 p-4 text-sm text-[#A65E45]" role="alert">
            <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}

        {!data && !error && (
          <p className="mt-10 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading your booking…</p>
        )}

        {data && (
          <>
            <section className="mt-6 rounded-2xl border border-border bg-card p-5" aria-label="Booking summary" data-testid="pay-summary">
              <p className="text-sm text-primary/80">Hello {data.guestFirstName},</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm tabular-nums">
                <dt className="text-muted-foreground">Check-in</dt><dd className="text-right text-primary">{pretty(data.checkIn)}</dd>
                <dt className="text-muted-foreground">Check-out</dt><dd className="text-right text-primary">{pretty(data.checkOut)}</dd>
                <dt className="text-muted-foreground">Stay</dt><dd className="text-right text-primary">{data.nights} night{data.nights === 1 ? '' : 's'} · {data.guests} guest{data.guests === 1 ? '' : 's'}{data.pets ? ` · ${data.pets} pet${data.pets === 1 ? '' : 's'}` : ''}</dd>
                <dt className="text-muted-foreground">Total</dt><dd className="text-right text-primary">{formatRupees(data.totalPaise)}</dd>
                <dt className="font-bold text-primary">Advance now ({data.advancePercent}%)</dt><dd className="text-right text-lg font-bold text-primary" data-testid="text-pay-advance">{formatRupees(data.advancePaise)}</dd>
                <dt className="text-muted-foreground">Balance at check-in</dt><dd className="text-right text-primary">{formatRupees(data.balancePaise)}</dd>
                <dt className="text-muted-foreground">Reference</dt><dd className="text-right font-mono text-primary">{data.reference}</dd>
              </dl>
            </section>

            <p
              className={`mt-5 flex items-start gap-2 rounded-xl p-4 text-sm ${data.status === 'confirmed' ? 'bg-primary text-primary-foreground' : data.status === 'submitted' ? 'bg-secondary text-primary' : data.status === 'awaiting_payment' && left > 0 ? 'bg-card text-primary' : 'border border-[#A65E45]/40 bg-[#A65E45]/5 text-[#A65E45]'}`}
              role="status"
              data-testid="text-pay-status"
            >
              {data.status === 'awaiting_payment' && left > 0 ? <Clock size={16} className="mt-0.5 shrink-0" /> : data.status === 'submitted' || data.status === 'confirmed' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
              <span>
                {data.status === 'awaiting_payment' && left <= 0 ? 'This hold has expired and the dates have been released.' : data.statusText}
                {data.status === 'awaiting_payment' && left > 0 && <strong className="ml-1 tabular-nums" data-testid="text-pay-countdown"> {clock(left)} left.</strong>}
              </span>
            </p>

            {payable && (
              <section className="mt-6 space-y-5" aria-label="Pay by UPI">
                <a
                  href={data.upiUrl!}
                  className={`flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-4 text-sm font-bold uppercase tracking-[.1em] text-primary-foreground ${mobile ? '' : 'md:hidden'}`}
                  data-testid="link-pay-upi"
                >
                  <Smartphone size={17} /> Pay {formatRupees(data.advancePaise)} with UPI app
                </a>
                {data.qrSvg && (
                  <div className={`${mobile ? 'hidden' : 'flex'} flex-col items-center rounded-2xl border border-border bg-white p-5`} data-testid="pay-qr">
                    {/* Generated by the server from the same upi:// link; no external QR service. */}
                    <div className="h-56 w-56" dangerouslySetInnerHTML={{ __html: data.qrSvg }} />
                    <p className="mt-3 text-center text-xs text-[#1d3a2f]">Scan with any UPI app (GPay, PhonePe, Paytm, BHIM) — the amount fills itself.</p>
                  </div>
                )}
                {data.payee && (
                  <p className="text-center text-xs text-muted-foreground">
                    Or pay {formatRupees(data.advancePaise)} to <span className="font-mono text-primary">{data.payee.upiId}</span> ({data.payee.name}) with note <span className="font-mono text-primary">{data.reference}</span>
                    <button type="button" onClick={copyUpi} className="ml-2 inline-flex items-center gap-1 text-accent underline underline-offset-2"><Copy size={12} /> {copied ? 'Copied' : 'Copy UPI ID'}</button>
                  </p>
                )}

                <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border bg-card p-5" data-testid="form-pay-utr">
                  <p className="text-sm font-bold text-primary">Paid? Tell us the transaction ID</p>
                  <label className="block">
                    <span className="eyebrow text-muted-foreground">UPI transaction ID / UTR (12 digits) *</span>
                    <input
                      id="pay-utr"
                      required
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={16}
                      value={utr}
                      onChange={(event) => setUtr(event.target.value)}
                      className="mt-2 w-full border-b border-border bg-transparent px-0 py-3 font-mono text-lg tracking-widest text-primary outline-none focus:border-primary"
                      placeholder="412345678901"
                      data-testid="input-pay-utr"
                    />
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <Upload size={14} />
                    <span>{file ? file.name : 'Add payment screenshot (optional, image up to 5 MB)'}</span>
                    <input
                      id="pay-screenshot"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] ?? null)}
                      data-testid="input-pay-screenshot"
                    />
                  </label>
                  {formError && <p className="text-[13px] text-[#A65E45]" role="alert">{formError}</p>}
                  <button
                    type="submit"
                    disabled={sending}
                    className="flex w-full items-center justify-center gap-2 rounded-full border border-primary/25 px-5 py-3.5 text-xs font-bold uppercase tracking-[.1em] text-primary hover:bg-primary/5 disabled:opacity-40"
                    data-testid="button-pay-submit"
                  >
                    {sending && <Loader2 size={14} className="animate-spin" />} I have paid — submit
                  </button>
                </form>
              </section>
            )}

            <p className="mt-8 text-center text-xs text-muted-foreground">
              Questions or a problem paying? Call or WhatsApp <a href={phoneHref(CONFIG.hostPhone)} className="text-primary underline">{CONFIG.hostPhone}</a>.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
