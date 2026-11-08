import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { AlertIcon, CheckCircleIcon, ClockIcon, CopyIcon, DownloadIcon, ShareIcon, SpinnerIcon, UploadIcon, WhatsappIcon } from '@/components/icons';

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
  securityDepositPaise?: number;
  advancePercent: number;
  holdExpiresAt: string;
  secondsLeft: number;
  utrSubmitted: boolean;
  payee: { upiId: string; name: string } | null;
  upiUrl: string | null;
  qrSvg: string | null;
  onlinePay?: boolean;
  /** Convenience fee on card / net banking (0 = none). UPI is always free. */
  cardFee?: { feePaise: number; percent: number };
  confirmationReady?: boolean;
  /** The PDF this guest can download now: summary (payment pending) or confirmation. */
  document?: 'summary' | 'confirmation' | null;
};

type CashfreeCheckout = { checkout: (options: { paymentSessionId: string; redirectTarget: '_self' }) => Promise<unknown> };
declare global {
  interface Window {
    Cashfree?: (options: { mode: 'sandbox' | 'production' }) => CashfreeCheckout;
  }
}

const TOKEN_KEY = 'rk-pay-token';
const CASHFREE_SDK = 'https://sdk.cashfree.com/js/v3/cashfree.js';

function tokenFromFragment(): string {
  if (typeof window === 'undefined') return '';
  return decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
}

/**
 * The token from the fragment, or — on the way back from the Cashfree
 * checkout, whose return URL carries only the order id — from this tab's
 * session storage, where it was put just before leaving.
 */
function initialToken(): string {
  const fromHash = tokenFromFragment();
  try {
    if (fromHash) sessionStorage.setItem(TOKEN_KEY, fromHash);
    return fromHash || sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return fromHash;
  }
}

function returningOrderId(): string | null {
  if (typeof window === 'undefined') return null;
  const id = new URLSearchParams(window.location.search).get('order_id');
  return id && /^[A-Za-z0-9_-]{3,50}$/.test(id) ? id : null;
}

function loadCashfree(): Promise<NonNullable<Window['Cashfree']>> {
  if (window.Cashfree) return Promise.resolve(window.Cashfree);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CASHFREE_SDK;
    script.async = true;
    script.onload = () => (window.Cashfree ? resolve(window.Cashfree) : reject(new Error('Cashfree did not load')));
    script.onerror = () => reject(new Error('Cashfree did not load'));
    document.head.appendChild(script);
  });
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
  const [token] = useState(initialToken);
  const [returnOrder, setReturnOrder] = useState<string | null>(returningOrderId);
  const [verifying, setVerifying] = useState(false);
  const [onlineNote, setOnlineNote] = useState<string | null>(null);
  // Which checkout is opening: 'all' (no fee configured), 'upi' or 'card'.
  const [opening, setOpening] = useState<'all' | 'upi' | 'card' | null>(null);
  const [data, setData] = useState<PayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [utr, setUtr] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [docBusy, setDocBusy] = useState<'download' | 'share' | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
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

  // Back from the Cashfree checkout: ask the server (which asks Cashfree)
  // what happened. A payment can take a minute to settle, so keep asking
  // for a little while before handing over to the "we'll confirm" message.
  useEffect(() => {
    if (!returnOrder || !token) return;
    let tries = 0;
    let stopped = false;
    let timer: number | undefined;
    setVerifying(true);

    const check = async () => {
      tries += 1;
      try {
        const response = await fetch('/api/book/pay/cashfree/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, orderId: returnOrder }),
        });
        const body = await response.json().catch(() => ({}));
        if (stopped) return;
        if (!response.ok) {
          setOnlineNote(body.error ?? 'We could not check the payment just now.');
        } else if (body.status === 'pending' && tries < 18) {
          setOnlineNote('Waiting for the bank to confirm your payment…');
          timer = window.setTimeout(() => void check(), 10_000);
          return;
        } else if (body.status === 'pending') {
          setOnlineNote('Your bank has not confirmed the payment yet. If money has left your account, it is safe: we will confirm by WhatsApp or email shortly.');
        } else if (body.status === 'closed') {
          setOnlineNote('That payment was not completed. You can try again below.');
        } else {
          setOnlineNote(null);
        }
      } catch {
        if (!stopped) setOnlineNote('Could not reach the server. Please refresh in a moment.');
      }
      if (stopped) return;
      setVerifying(false);
      setReturnOrder(null);
      // Back to the plain /pay#token address, so a refresh works as before.
      window.history.replaceState(null, '', `${window.location.pathname}#${encodeURIComponent(token)}`);
      void load();
    };

    void check();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [returnOrder, token, load]);

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

  const payOnline = async (method?: 'upi' | 'card') => {
    setOnlineNote(null);
    setOpening(method ?? 'all');
    try {
      const response = await fetch('/api/book/pay/cashfree/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(method ? { token, method } : { token }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setOnlineNote(body.error ?? 'Online payment is not available just now. Please pay by UPI below.');
        if (response.status === 410) void load();
        return;
      }
      try {
        sessionStorage.setItem(TOKEN_KEY, token);
      } catch {
        /* the return page then asks for the link again; payment still settles */
      }
      const Cashfree = await loadCashfree();
      await Cashfree({ mode: body.mode === 'production' ? 'production' : 'sandbox' }).checkout({
        paymentSessionId: body.paymentSessionId,
        redirectTarget: '_self',
      });
    } catch {
      setOnlineNote('The secure checkout could not open. Please check your connection, or pay by UPI below.');
    } finally {
      setOpening(null);
    }
  };

  // The booking PDF: summary (QR for the advance) or, once confirmed, the
  // confirmation. POSTed with the token, never put in a URL.
  const fetchDocument = async (): Promise<{ blob: Blob; filename: string } | null> => {
    setDocError(null);
    const response = await fetch('/api/book/pay/document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setDocError(body.error ?? 'Could not get the PDF just now. Please try again.');
      return null;
    }
    const filename =
      /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? `Booking-${data?.reference ?? 'Raj-Kuthir'}.pdf`;
    return { blob: await response.blob(), filename };
  };

  const downloadDocument = async () => {
    setDocBusy('download');
    try {
      const doc = await fetchDocument();
      if (!doc) return;
      const url = URL.createObjectURL(doc.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = doc.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setDocError('Could not reach the server. Please check your connection and try again.');
    } finally {
      setDocBusy(null);
    }
  };

  // On phones: the share sheet with the PDF attached, so it can go straight
  // into a WhatsApp chat. Where files cannot be shared, it downloads instead.
  const shareDocument = async () => {
    setDocBusy('share');
    try {
      const doc = await fetchDocument();
      if (!doc) return;
      const file = new File([doc.blob], doc.filename, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: doc.filename });
      } else {
        const url = URL.createObjectURL(doc.blob);
        window.open(url, '_blank', 'noopener');
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setDocError('Could not share the PDF. Please use Download instead.');
      }
    } finally {
      setDocBusy(null);
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
  const online = data?.status === 'awaiting_payment' && left > 0 && data.onlinePay && !verifying;

  // The guest's own WhatsApp, opened on a chat with us, the booking already typed.
  const ownerWhatsappUrl = data
    ? `https://wa.me/${CONFIG.hostPhone.replace(/\D/g, '')}?text=${encodeURIComponent(
        [
          data.status === 'confirmed'
            ? `Hello Raj Kuthir, this is ${data.guestFirstName}. My booking ${data.reference} is confirmed — thank you!`
            : `Hello Raj Kuthir, this is ${data.guestFirstName}. I have booked Sobuj Potro.`,
          `Booking reference: ${data.reference}`,
          `Check-in: ${pretty(data.checkIn)} · Check-out: ${pretty(data.checkOut)}`,
          `Guests: ${data.guests}${data.pets ? ` · Pets: ${data.pets}` : ''}`,
          `Advance: ${formatRupees(data.advancePaise)} of ${formatRupees(data.totalPaise)}`,
          data.status === 'awaiting_payment' ? "I'm paying the advance with the QR now and will send the payment screenshot here." : '',
          data.status === 'submitted' ? "I've paid the advance — the payment screenshot is attached." : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )}`
    : '';

  return (
    <div className="min-h-[100dvh] bg-background px-4 py-10 text-foreground">
      <main className="mx-auto max-w-[560px]">
        <a href={`${basePath}/`} className="eyebrow text-accent">Raj Kuthir Homestays – Sobuj Potro</a>
        <h1 className="mt-3 font-journal text-4xl leading-tight text-primary">Complete your booking</h1>

        {error && (
          <p className="mt-6 flex items-start gap-2 rounded-xl border border-terracotta/40 bg-terracotta/5 p-4 text-sm text-terracotta" role="alert">
            <AlertIcon className="mt-0.5 shrink-0" /> {error}
          </p>
        )}

        {!data && !error && (
          <p className="mt-10 flex items-center gap-2 text-sm text-muted-foreground"><SpinnerIcon className="animate-spin" /> Loading your booking…</p>
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
                <dt className="font-bold text-primary">{data.advancePercent >= 100 ? 'Peak dates, paid in full now' : `Advance now (${data.advancePercent}%)`}</dt><dd className="text-right text-lg font-bold text-primary" data-testid="text-pay-advance">{formatRupees(data.advancePaise)}</dd>
                <dt className="text-muted-foreground">Balance at check-in</dt><dd className="text-right text-primary">{formatRupees(data.balancePaise)}</dd>
                {data.securityDepositPaise ? (
                  <>
                    <dt className="text-muted-foreground">Security deposit (refundable)</dt><dd className="text-right text-primary">{formatRupees(data.securityDepositPaise)} at check-in</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Reference</dt><dd className="text-right font-mono text-primary">{data.reference}</dd>
              </dl>
            </section>

            <p
              className={`mt-5 flex items-start gap-2 rounded-xl p-4 text-sm ${data.status === 'confirmed' ? 'bg-primary text-primary-foreground' : data.status === 'submitted' ? 'bg-secondary text-primary' : data.status === 'awaiting_payment' && left > 0 ? 'bg-card text-primary' : 'border border-terracotta/40 bg-terracotta/5 text-terracotta'}`}
              role="status"
              data-testid="text-pay-status"
            >
              {data.status === 'awaiting_payment' && left > 0 ? <ClockIcon className="mt-0.5 shrink-0" /> : data.status === 'submitted' || data.status === 'confirmed' ? <CheckCircleIcon className="mt-0.5 shrink-0" /> : <AlertIcon className="mt-0.5 shrink-0" />}
              <span>
                {data.status === 'awaiting_payment' && left <= 0 ? 'This hold has expired and the dates have been released.' : data.statusText}
                {data.status === 'awaiting_payment' && left > 0 && <strong className="ml-1 tabular-nums" data-testid="text-pay-countdown"> {clock(left)} left.</strong>}
              </span>
            </p>

            {data.document && (
              <section className="mt-5 rounded-2xl border border-border bg-card p-5" aria-label="Your booking document" data-testid="pay-document">
                <p className="text-sm font-bold text-primary">
                  {data.document === 'confirmation' ? 'Your booking confirmation' : 'Your booking summary'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.document === 'confirmation'
                    ? 'Your reference, what you have paid and the balance due at check-in.'
                    : 'Your dates, the amount and a QR code to pay the advance. Payment pending: the booking is confirmed once the advance reaches us.'}
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={downloadDocument}
                    disabled={docBusy !== null}
                    className="flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                    data-testid="button-download-document"
                  >
                    {docBusy === 'download' ? <SpinnerIcon className="animate-spin" /> : <DownloadIcon />} Download PDF
                  </button>
                  <button
                    type="button"
                    onClick={shareDocument}
                    disabled={docBusy !== null}
                    className="flex items-center justify-center gap-2 rounded-full border border-primary/25 px-4 py-3 text-sm font-semibold text-primary disabled:opacity-60"
                    data-testid="button-share-document"
                  >
                    {docBusy === 'share' ? <SpinnerIcon className="animate-spin" /> : <ShareIcon />} Share PDF
                  </button>
                </div>
                <a
                  href={ownerWhatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 flex items-center justify-center gap-2 rounded-full bg-[#1f7a4d] px-4 py-3 text-sm font-semibold text-white"
                  data-testid="link-whatsapp-owner"
                >
                  <WhatsappIcon /> WhatsApp your booking to us
                </a>
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Opens your WhatsApp with your booking details typed in. To send the PDF too, tap Share PDF and choose our chat ({CONFIG.hostPhone}).
                </p>
                {docError && <p className="mt-2 text-center text-[13px] text-terracotta" role="alert">{docError}</p>}
              </section>
            )}

            {verifying && (
              <p className="mt-5 flex items-center gap-2 rounded-xl bg-card p-4 text-sm text-primary" role="status" data-testid="text-pay-verifying">
                <SpinnerIcon className="animate-spin" /> {onlineNote ?? 'Checking your payment…'}
              </p>
            )}
            {!verifying && onlineNote && (
              <p className="mt-5 flex items-start gap-2 rounded-xl border border-border bg-card p-4 text-sm text-primary" role="status" data-testid="text-pay-online-note">
                <AlertIcon className="mt-0.5 shrink-0" /> {onlineNote}
              </p>
            )}

            {online && (
              <section className="mt-6" aria-label="Pay online">
                {data.cardFee && data.cardFee.feePaise > 0 ? (
                  <>
                    {/* With a convenience fee: UPI (free) and card / net banking
                        (plus the fee, shown before the guest pays) are separate. */}
                    <button
                      type="button"
                      onClick={() => payOnline('upi')}
                      disabled={opening !== null}
                      className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                      data-testid="button-pay-online-upi"
                    >
                      {opening === 'upi' && <SpinnerIcon className="animate-spin" />} Pay {formatRupees(data.advancePaise)} by UPI
                    </button>
                    <p className="mt-2 text-center text-xs text-muted-foreground">No convenience fee on UPI.</p>
                    <button
                      type="button"
                      onClick={() => payOnline('card')}
                      disabled={opening !== null}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-primary/25 px-5 py-4 text-sm font-semibold text-primary disabled:opacity-60"
                      data-testid="button-pay-online-card"
                    >
                      {opening === 'card' && <SpinnerIcon className="animate-spin" />} Card or net banking: {formatRupees(data.advancePaise + data.cardFee.feePaise)}
                    </button>
                    <p className="mt-2 text-center text-xs text-muted-foreground" data-testid="text-card-fee">
                      Includes a {formatRupees(data.cardFee.feePaise)} convenience fee ({data.cardFee.percent}% for card and net banking payments). The fee is not refundable.
                    </p>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => payOnline()}
                    disabled={opening !== null}
                    className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                    data-testid="button-pay-online"
                  >
                    {opening && <SpinnerIcon className="animate-spin" />} Pay {formatRupees(data.advancePaise)} online
                  </button>
                )}
                <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                  {data.cardFee && data.cardFee.feePaise > 0 ? 'Secure checkout by Cashfree' : 'UPI, cards or net banking · secure checkout by Cashfree'} · booking confirmed instantly
                </p>
                {payable && (
                  <p className="mt-6 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="h-px flex-1 bg-border" /> or pay directly by UPI <span className="h-px flex-1 bg-border" />
                  </p>
                )}
              </section>
            )}

            {payable && !verifying && (
              <section className="mt-6 space-y-5" aria-label="Pay by UPI">
                <a
                  href={data.upiUrl!}
                  className={`flex w-full items-center justify-center gap-2 rounded-full px-5 py-4 text-sm font-semibold ${data.onlinePay ? 'border border-primary/25 text-primary' : 'bg-primary text-primary-foreground'} ${mobile ? '' : 'md:hidden'}`}
                  data-testid="link-pay-upi"
                >
                  Pay {formatRupees(data.advancePaise)} with UPI app
                </a>
                {data.qrSvg && (
                  <div className={`${mobile ? 'hidden' : 'flex'} flex-col items-center rounded-2xl border border-border bg-white p-5`} data-testid="pay-qr">
                    {/* Generated by the server from the same upi:// link; no external QR service. */}
                    <div className="h-56 w-56" dangerouslySetInnerHTML={{ __html: data.qrSvg }} />
                    <p className="mt-3 text-center text-xs text-pine">Scan with any UPI app (GPay, PhonePe, Paytm, BHIM). The amount fills itself.</p>
                  </div>
                )}
                {data.payee && (
                  <p className="text-center text-xs text-muted-foreground">
                    Or pay {formatRupees(data.advancePaise)} to <span className="font-mono text-primary">{data.payee.upiId}</span> ({data.payee.name}) with note <span className="font-mono text-primary">{data.reference}</span>
                    <button type="button" onClick={copyUpi} className="ml-2 inline-flex items-center gap-1 text-accent underline underline-offset-2"><CopyIcon /> {copied ? 'Copied' : 'Copy UPI ID'}</button>
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
                      className="mt-2 w-full border-b border-border bg-transparent px-0 py-3 font-mono text-lg tracking-widest text-primary focus:border-primary"
                      placeholder="412345678901"
                      data-testid="input-pay-utr"
                    />
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <UploadIcon />
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
                  {formError && <p className="text-[13px] text-terracotta" role="alert">{formError}</p>}
                  <button
                    type="submit"
                    disabled={sending}
                    className="flex w-full items-center justify-center gap-2 rounded-full border border-primary/25 px-5 py-3.5 text-sm font-semibold text-primary hover:bg-primary/5 disabled:opacity-40"
                    data-testid="button-pay-submit"
                  >
                    {sending && <SpinnerIcon className="animate-spin" />} I have paid: submit
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
