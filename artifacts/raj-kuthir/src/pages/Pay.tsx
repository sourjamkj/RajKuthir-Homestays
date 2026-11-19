import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { AlertIcon, CheckCircleIcon, CheckIcon, ClockIcon, CopyIcon, DownloadIcon, LockIcon, ShareIcon, SpinnerIcon, UploadIcon, WhatsappIcon } from '@/components/icons';

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
type RazorpaySuccess = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type RazorpayCheckout = { open: () => void; on: (event: 'payment.failed', handler: (response: { error?: { description?: string } }) => void) => void };
declare global {
  interface Window {
    Cashfree?: (options: { mode: 'sandbox' | 'production' }) => CashfreeCheckout;
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

const TOKEN_KEY = 'rk-pay-token';
const CASHFREE_SDK = 'https://sdk.cashfree.com/js/v3/cashfree.js';
const RAZORPAY_SDK = 'https://checkout.razorpay.com/v1/checkout.js';

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

function loadSdk<T>(src: string, get: () => T | undefined): Promise<T> {
  const ready = get();
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      const loaded = get();
      if (loaded) resolve(loaded);
      else reject(new Error('Checkout did not load'));
    };
    script.onerror = () => reject(new Error('Checkout did not load'));
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
  // The method the guest picked: Razorpay UPI, Razorpay card / net banking, or paying the UPI QR themselves.
  const [method, setMethod] = useState<'upi' | 'card' | 'qr' | null>(null);
  const [cancelStep, setCancelStep] = useState<'idle' | 'confirm' | 'busy' | 'done'>('idle');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [homeIn, setHomeIn] = useState(30);
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

  // Razorpay hands back a signed result in the page; the server checks the
  // signature and asks Razorpay before it books anything.
  const verifyRazorpay = async (orderId: string, response: RazorpaySuccess) => {
    setVerifying(true);
    setOnlineNote('Confirming your payment…');
    try {
      const result = await fetch('/api/book/pay/razorpay/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, orderId, ...response }),
      });
      const body = await result.json().catch(() => ({}));
      if (!result.ok) setOnlineNote(body.error ?? 'We could not check the payment just now.');
      else if (body.status === 'pending') setOnlineNote('Your bank has not confirmed the payment yet. If money has left your account, it is safe: we will confirm by WhatsApp or email shortly.');
      else setOnlineNote(null);
    } catch {
      setOnlineNote('Could not reach the server. If money has left your account, it is safe: we will confirm shortly.');
    } finally {
      setVerifying(false);
      void load();
    }
  };

  const payOnline = async (method?: 'upi' | 'card') => {
    setOnlineNote(null);
    setOpening(method ?? 'all');
    try {
      const response = await fetch('/api/book/pay/order', {
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
      if (body.provider === 'razorpay') {
        const Razorpay = await loadSdk(RAZORPAY_SDK, () => window.Razorpay);
        const only = body.razorpay.method;
        const checkout = new Razorpay({
          key: body.razorpay.keyId,
          order_id: body.razorpay.orderId,
          amount: body.amountPaise,
          currency: 'INR',
          name: 'Raj Kuthir Homestays',
          description: `Advance ${data?.reference ?? ''}`.trim(),
          // The guest's own name and number from the booking, so the checkout opens on payment, not on "Contact details".
          ...(body.razorpay.prefill ? { prefill: body.razorpay.prefill } : {}),
          // With a card convenience fee the guest chose UPI or card; the server already priced that choice.
          ...(only === 'upi'
            ? { method: { upi: true, card: false, netbanking: false, wallet: false, emi: false, paylater: false } }
            : only === 'card'
              ? { method: { upi: false } }
              : {}),
          theme: { color: '#2f5d3a' },
          // The checkout closes itself when the hold ends, like a seat hold.
          timeout: Math.max(60, left),
          handler: (response: RazorpaySuccess) => void verifyRazorpay(body.orderId, response),
          modal: { ondismiss: () => setOnlineNote('Payment cancelled. You can try again below, or pay by UPI.') },
        });
        checkout.on('payment.failed', (response) =>
          setOnlineNote(`The payment did not go through${response.error?.description ? `: ${response.error.description}` : ''}. You can try again below.`),
        );
        checkout.open();
        return;
      }
      const Cashfree = await loadSdk(CASHFREE_SDK, () => window.Cashfree);
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
  const fee = data?.cardFee && data.cardFee.feePaise > 0 ? data.cardFee : null;
  // Online first when it is switched on; the QR is the fallback, never the default.
  const chosen = method ?? (online ? 'upi' : payable ? 'qr' : null);
  const dueNow = data ? data.advancePaise + (chosen === 'card' && fee ? fee.feePaise : 0) : 0;
  const holdTotal = data ? Math.max(left, data.secondsLeft) : 0;

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

  const methodOptions: Array<{ id: 'upi' | 'card' | 'qr'; title: string; detail: string; badge: string; amount: number }> = data
    ? [
        ...(online
          ? fee
            ? [
                { id: 'upi' as const, title: 'UPI', detail: 'GPay, PhonePe, Paytm, BHIM or any UPI app', badge: 'No fee', amount: data.advancePaise },
                { id: 'card' as const, title: 'Card or net banking', detail: `Debit or credit card, or your bank. Includes a ${fee.percent}% convenience fee, not refundable.`, badge: `+${formatRupees(fee.feePaise)}`, amount: data.advancePaise + fee.feePaise },
              ]
            : [{ id: 'upi' as const, title: 'UPI, card or net banking', detail: 'Any UPI app, debit or credit card, or your bank', badge: 'Instant', amount: data.advancePaise }]
          : []),
        ...(payable
          ? [{ id: 'qr' as const, title: mobile ? 'Pay from my UPI app' : 'Scan a UPI QR myself', detail: 'Pay us directly, then enter the 12-digit transaction ID. We confirm once we see it.', badge: 'Manual', amount: data.advancePaise }]
          : []),
      ]
    : [];

  // After a cancel, count down and take the guest back to the homepage.
  useEffect(() => {
    if (cancelStep !== 'done') return;
    if (homeIn <= 0) {
      window.location.assign(`${basePath}/`);
      return;
    }
    const t = window.setTimeout(() => setHomeIn((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cancelStep, homeIn]);

  const cancelBooking = async () => {
    setCancelStep('busy');
    setCancelError(null);
    try {
      const response = await fetch('/api/book/pay/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setCancelError(body.error ?? 'Could not cancel just now. Please try again, or call us.');
        setCancelStep('confirm');
        return;
      }
      setCancelStep('done');
      setOnlineNote(null);
      void load();
    } catch {
      setCancelError('Could not reach the server. Please try again, or call us.');
      setCancelStep('confirm');
    }
  };

  const startPayment = () => {
    if (chosen === 'qr') return;
    void payOnline(fee ? (chosen === 'card' ? 'card' : 'upi') : undefined);
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border bg-card/70">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-4 px-4 py-4">
          <a href={`${basePath}/`} className="min-w-0">
            <span className="block font-journal text-xl leading-none text-primary">Raj Kuthir Homestays</span>
            <span className="eyebrow mt-1 block text-accent">Sobuj Potro · Shantiniketan</span>
          </a>
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-primary/80">
            <LockIcon /> Secure checkout
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[1080px] px-4 pb-16 pt-8">
        {error && (
          <p className="flex items-start gap-2 rounded-xl border border-terracotta/40 bg-terracotta/5 p-4 text-sm text-terracotta" role="alert">
            <AlertIcon className="mt-0.5 shrink-0" /> {error}
          </p>
        )}

        {!data && !error && (
          <p className="mt-10 flex items-center gap-2 text-sm text-muted-foreground"><SpinnerIcon className="animate-spin" /> Loading your booking…</p>
        )}

        {data && (
          <>
            <h1 className="font-journal text-4xl leading-tight text-primary md:text-5xl">
              {cancelStep === 'done' ? 'Booking cancelled.' : data.status === 'confirmed' ? 'You are booked in.' : data.status === 'submitted' ? 'Payment received, checking now.' : 'Complete your booking'}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">Hello {data.guestFirstName}, booking <span className="font-mono text-primary">{data.reference}</span></p>

            {/* The hold: the one deadline on this page, with the time it has left. */}
            <div
              className={`mt-6 rounded-2xl p-4 text-sm ${data.status === 'confirmed' ? 'bg-primary text-primary-foreground' : data.status === 'submitted' ? 'bg-secondary text-primary' : data.status === 'awaiting_payment' && left > 0 ? 'border border-border bg-card text-primary' : 'border border-terracotta/40 bg-terracotta/5 text-terracotta'}`}
              role="status"
              data-testid="text-pay-status"
            >
              <p className="flex items-start gap-2">
                {data.status === 'awaiting_payment' && left > 0 ? <ClockIcon className="mt-0.5 shrink-0" /> : data.status === 'submitted' || data.status === 'confirmed' ? <CheckCircleIcon className="mt-0.5 shrink-0" /> : <AlertIcon className="mt-0.5 shrink-0" />}
                <span className="flex-1">{cancelStep === 'done' ? 'You cancelled this booking. Nothing was charged and the dates are free again.' : data.status === 'awaiting_payment' && left <= 0 ? 'This hold has expired and the dates have been released.' : data.statusText}</span>
                {data.status === 'awaiting_payment' && left > 0 && <strong className="shrink-0 tabular-nums" data-testid="text-pay-countdown">{clock(left)} left</strong>}
              </p>
              {cancelStep === 'done' && (
                <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 pl-6">
                  <a href={`${basePath}/`} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" data-testid="link-pay-home">
                    Back to the homepage
                  </a>
                  <span className="text-[13px] tabular-nums text-muted-foreground" aria-live="off">Taking you there in {homeIn}s</span>
                </p>
              )}
              {data.status === 'awaiting_payment' && left > 0 && holdTotal > 0 && (
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-primary/10" aria-hidden="true">
                  <div className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear" style={{ width: `${Math.min(100, (left / holdTotal) * 100)}%` }} />
                </div>
              )}
            </div>

            {/* Phone: summary, then payment, then the PDF. Wide screen: payment on the left, summary and PDF on the right. */}
            <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_1fr] lg:gap-x-8">
                <section className="rounded-2xl border border-border bg-card p-5 lg:col-start-2 lg:row-start-1" aria-label="Booking summary" data-testid="pay-summary">
                  <p className="eyebrow text-muted-foreground">Your stay</p>
                  <p className="mt-2 font-journal text-2xl leading-tight text-primary">Sobuj Potro, the whole villa</p>
                  <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm tabular-nums">
                    <dt className="text-muted-foreground">Check-in</dt><dd className="text-right text-primary">{pretty(data.checkIn)}, 12 noon</dd>
                    <dt className="text-muted-foreground">Check-out</dt><dd className="text-right text-primary">{pretty(data.checkOut)}, 11 am</dd>
                    <dt className="text-muted-foreground">Stay</dt><dd className="text-right text-primary">{data.nights} night{data.nights === 1 ? '' : 's'} · {data.guests} guest{data.guests === 1 ? '' : 's'}{data.pets ? ` · ${data.pets} pet${data.pets === 1 ? '' : 's'}` : ''}</dd>
                  </dl>
                  <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 border-t border-border pt-4 text-sm tabular-nums">
                    <dt className="text-muted-foreground">Total for the stay</dt><dd className="text-right text-primary">{formatRupees(data.totalPaise)}</dd>
                    <dt className="text-muted-foreground">{data.advancePercent >= 100 ? 'Peak dates, paid in full' : `Advance (${data.advancePercent}%)`}</dt><dd className="text-right text-primary">{formatRupees(data.advancePaise)}</dd>
                    {chosen === 'card' && fee && data.status === 'awaiting_payment' && (
                      <>
                        <dt className="text-muted-foreground">Convenience fee ({fee.percent}%)</dt><dd className="text-right text-primary" data-testid="text-card-fee">{formatRupees(fee.feePaise)}</dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">Balance at check-in</dt><dd className="text-right text-primary">{formatRupees(data.balancePaise)}</dd>
                    {data.securityDepositPaise ? (
                      <>
                        <dt className="text-muted-foreground">Security deposit, refundable</dt><dd className="text-right text-primary">{formatRupees(data.securityDepositPaise)} at check-in</dd>
                      </>
                    ) : null}
                  </dl>
                  {data.status === 'awaiting_payment' && (
                    <div className="mt-4 flex items-baseline justify-between border-t border-border pt-4">
                      <span className="text-sm font-bold text-primary">Pay now</span>
                      <span className="text-2xl font-bold tabular-nums text-primary" data-testid="text-pay-advance">{formatRupees(dueNow)}</span>
                    </div>
                  )}
                </section>

              <div className="lg:col-start-1 lg:row-span-2 lg:row-start-1">
                {verifying && (
                  <p className="mb-5 flex items-center gap-2 rounded-xl bg-card p-4 text-sm text-primary" role="status" data-testid="text-pay-verifying">
                    <SpinnerIcon className="animate-spin" /> {onlineNote ?? 'Checking your payment…'}
                  </p>
                )}
                {!verifying && onlineNote && (
                  <p className="mb-5 flex items-start gap-2 rounded-xl border border-border bg-card p-4 text-sm text-primary" role="status" data-testid="text-pay-online-note">
                    <AlertIcon className="mt-0.5 shrink-0" /> {onlineNote}
                  </p>
                )}

                {methodOptions.length > 0 && !verifying && (
                  <section aria-labelledby="pay-method-title">
                    <h2 id="pay-method-title" className="text-lg font-bold text-primary">How would you like to pay?</h2>
                    <div className="mt-4 space-y-3" role="radiogroup" aria-labelledby="pay-method-title">
                      {methodOptions.map((option) => {
                        const active = chosen === option.id;
                        return (
                          <label
                            key={option.id}
                            className={`flex cursor-pointer items-start gap-4 rounded-2xl border bg-card p-4 transition-colors ${active ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/40'}`}
                            data-testid={`pay-method-${option.id}`}
                          >
                            <input type="radio" name="pay-method" value={option.id} checked={active} onChange={() => setMethod(option.id)} className="sr-only" />
                            <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`} aria-hidden="true">
                              {active && <CheckIcon />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-primary">{option.title}</span>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.07em] ${option.badge.startsWith('+') ? 'bg-terracotta/10 text-terracotta' : 'bg-secondary text-primary'}`}>{option.badge}</span>
                              </span>
                              <span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.detail}</span>
                            </span>
                            <span className="shrink-0 font-semibold tabular-nums text-primary">{formatRupees(option.amount)}</span>
                          </label>
                        );
                      })}
                    </div>

                    {chosen !== 'qr' && (
                      <>
                        <button
                          type="button"
                          onClick={startPayment}
                          disabled={opening !== null}
                          className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-4 text-base font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
                          data-testid={fee ? `button-pay-online-${chosen === 'card' ? 'card' : 'upi'}` : 'button-pay-online'}
                        >
                          {opening ? <SpinnerIcon className="animate-spin" /> : <LockIcon />} Pay {formatRupees(dueNow)} securely
                        </button>
                        <p className="mt-3 text-center text-xs leading-5 text-muted-foreground">
                          Payments are processed by Razorpay. We never see your card details or UPI PIN. Your booking is confirmed the moment the payment goes through.
                        </p>
                      </>
                    )}
                  </section>
                )}

                {payable && chosen === 'qr' && !verifying && (
                  <section className="mt-6 space-y-5" aria-label="Pay by UPI">
                    <a
                      href={data.upiUrl!}
                      className={`flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-4 text-sm font-semibold text-primary-foreground ${mobile ? '' : 'md:hidden'}`}
                      data-testid="link-pay-upi"
                    >
                      Open my UPI app to pay {formatRupees(data.advancePaise)}
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

                {data.status === 'awaiting_payment' && left > 0 && !verifying && (
                  <div className="mt-8 border-t border-border pt-5 text-center lg:text-left" data-testid="pay-cancel">
                    {cancelStep === 'idle' ? (
                      <button type="button" onClick={() => setCancelStep('confirm')} className="text-sm font-semibold text-terracotta underline underline-offset-2" data-testid="button-pay-cancel">
                        Cancel this booking
                      </button>
                    ) : (
                      <div className="rounded-2xl border border-terracotta/40 bg-terracotta/5 p-4">
                        <p className="text-sm text-primary">Cancel your booking for {pretty(data.checkIn)}? Nothing has been charged, and the dates will be released for other guests.</p>
                        <div className="mt-3 flex flex-wrap justify-center gap-2 lg:justify-start">
                          <button type="button" onClick={cancelBooking} disabled={cancelStep === 'busy'} className="flex items-center gap-2 rounded-full bg-terracotta px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" data-testid="button-pay-cancel-confirm">
                            {cancelStep === 'busy' && <SpinnerIcon className="animate-spin" />} Yes, cancel
                          </button>
                          <button type="button" onClick={() => setCancelStep('idle')} disabled={cancelStep === 'busy'} className="rounded-full border border-primary/25 px-4 py-2 text-sm font-semibold text-primary">
                            Keep my booking
                          </button>
                        </div>
                        {cancelError && <p className="mt-2 text-[13px] text-terracotta" role="alert">{cancelError}</p>}
                      </div>
                    )}
                  </div>
                )}

                <p className="mt-8 text-center text-xs text-muted-foreground lg:text-left">
                  Questions or a problem paying? Call or WhatsApp <a href={phoneHref(CONFIG.hostPhone)} className="text-primary underline">{CONFIG.hostPhone}</a>.
                </p>
              </div>

                {data.document && (
                  <section className="rounded-2xl border border-border bg-card p-5 lg:col-start-2 lg:row-start-2" aria-label="Your booking document" data-testid="pay-document">
                    <p className="text-sm font-bold text-primary">{data.document === 'confirmation' ? 'Your booking confirmation' : 'Your booking summary'}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {data.document === 'confirmation' ? 'Your reference, what you have paid and the balance due at check-in.' : 'Your dates and amount as a PDF. Payment pending until the advance reaches us.'}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button type="button" onClick={downloadDocument} disabled={docBusy !== null} className="flex items-center justify-center gap-1.5 rounded-full border border-primary/25 px-3 py-2.5 text-xs font-semibold text-primary disabled:opacity-60" data-testid="button-download-document">
                        {docBusy === 'download' ? <SpinnerIcon className="animate-spin" /> : <DownloadIcon />} Download
                      </button>
                      <button type="button" onClick={shareDocument} disabled={docBusy !== null} className="flex items-center justify-center gap-1.5 rounded-full border border-primary/25 px-3 py-2.5 text-xs font-semibold text-primary disabled:opacity-60" data-testid="button-share-document">
                        {docBusy === 'share' ? <SpinnerIcon className="animate-spin" /> : <ShareIcon />} Share
                      </button>
                    </div>
                    <a href={ownerWhatsappUrl} target="_blank" rel="noreferrer" className="mt-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-[#1f7a4d] underline underline-offset-2" data-testid="link-whatsapp-owner">
                      <WhatsappIcon /> WhatsApp your booking to us
                    </a>
                    {docError && <p className="mt-2 text-center text-[13px] text-terracotta" role="alert">{docError}</p>}
                  </section>
                )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
