import { useEffect, useState, type FormEvent } from 'react';
import { AlertIcon, SpinnerIcon, WhatsappIcon } from '@/components/icons';

import { formatRupees } from '@/lib/rates';
import { CONFIG, basePath, track } from '@/lib/site';

/**
 * /offer — the ready-to-pay link in an enquiry reply.
 *
 * The guest's dates, party and price (the owner's agreed price when he set
 * one) are already filled in from their enquiry; they check their name, add
 * an email if they like, and "Hold dates & pay" takes them straight to /pay.
 * The token is in the URL fragment, as on /pay, and every amount is
 * recomputed by the server; nothing on this page decides a price.
 */

type Offer = {
  name: string;
  phoneMasked: string;
  email: string | null;
  requests: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  pets: number;
  guests: number;
  totalPaise: number;
  advancePaise: number;
  balancePaise: number;
  peak: string | null;
  breakdown: string[];
  available: boolean;
  nextFree: { startDate: string; endDate: string }[];
  ready: boolean;
};

function pretty(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y!, m! - 1, d!)),
  );
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const WHATSAPP = `https://wa.me/${CONFIG.hostPhone.replace(/\D/g, '')}`;
const INPUT = 'w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-primary outline-none focus:border-primary';
const LABEL = 'mb-1 block text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground';

export default function Offer() {
  const [token] = useState(() => (typeof window === 'undefined' ? '' : window.location.hash.replace(/^#/, '')));
  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [requests, setRequests] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('This link is not complete. Please open it again from our WhatsApp message.');
      return;
    }
    let live = true;
    void (async () => {
      try {
        const response = await fetch('/api/book/offer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
        const body = await response.json().catch(() => ({}));
        if (!live) return;
        if (!response.ok) {
          setError(body.error ?? 'Could not open this offer just now. Please try again.');
          return;
        }
        setOffer(body as Offer);
        setName(body.name ?? '');
        setEmail(body.email ?? '');
        setRequests(body.requests ?? '');
        track('offer_open');
      } catch {
        if (live) setError('Could not open this offer just now. Please check your connection and try again.');
      }
    })();
    return () => {
      live = false;
    };
  }, [token]);

  async function hold(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/book/offer/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name, email, requests }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.payUrl) {
        track('offer_hold');
        window.location.assign(`${basePath}${body.payUrl}`);
        return;
      }
      setError(body.error ?? 'Could not hold those dates just now. Please try again.');
      if (response.status === 409 && offer) setOffer({ ...offer, available: false, nextFree: body.nextFree ?? [] });
    } catch {
      setError('Could not hold those dates just now. Please check your connection and try again.');
    }
    setBusy(false);
  }

  const party = offer
    ? [plural(offer.adults, 'adult'), offer.children ? `${offer.children} ${offer.children === 1 ? 'child' : 'children'}` : null, offer.pets ? plural(offer.pets, 'pet') : null]
        .filter(Boolean)
        .join(' · ')
    : '';
  const fullNow = offer ? offer.advancePaise >= offer.totalPaise : false;

  return (
    <div className="min-h-[100dvh] bg-background px-4 py-10 text-foreground">
      <main className="mx-auto max-w-[560px]">
        <a href={`${basePath}/`} className="eyebrow text-accent">Raj Kuthir Homestays – Sobuj Potro</a>
        <h1 className="mt-3 font-journal text-4xl leading-tight text-primary">Your stay, ready to book</h1>

        {error && (
          <p className="mt-6 flex items-start gap-2 rounded-xl border border-terracotta/40 bg-terracotta/5 p-4 text-sm text-terracotta" role="alert" data-testid="text-offer-error">
            <AlertIcon className="mt-0.5 shrink-0" /> {error}
          </p>
        )}

        {!offer && !error && (
          <p className="mt-10 flex items-center gap-2 text-sm text-muted-foreground"><SpinnerIcon className="animate-spin" /> Loading your offer…</p>
        )}

        {offer && (
          <>
            <section className="mt-6 rounded-2xl border border-border bg-card p-5" aria-label="Your stay" data-testid="offer-summary">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm tabular-nums">
                <dt className="text-muted-foreground">Check-in</dt><dd className="text-right text-primary">{pretty(offer.checkIn)}, from 12 noon</dd>
                <dt className="text-muted-foreground">Check-out</dt><dd className="text-right text-primary">{pretty(offer.checkOut)}, by 11 am</dd>
                <dt className="text-muted-foreground">Stay</dt><dd className="text-right text-primary">{plural(offer.nights, 'night')} · {party}</dd>
              </dl>
              {offer.breakdown.length > 0 && (
                <ul className="mt-4 space-y-1 border-t border-border pt-4 text-sm text-primary/80">
                  {offer.breakdown.map((line) => (
                    <li key={line}>• {line}</li>
                  ))}
                </ul>
              )}
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-4 text-sm tabular-nums">
                <dt className="text-muted-foreground">Total for the stay</dt><dd className="text-right text-primary">{formatRupees(offer.totalPaise)}</dd>
                <dt className="font-bold text-primary">{fullNow ? 'Pay now (in full)' : 'Advance to confirm'}</dt>
                <dd className="text-right text-lg font-bold text-primary" data-testid="text-offer-advance">{formatRupees(offer.advancePaise)}</dd>
                {!fullNow && (
                  <>
                    <dt className="text-muted-foreground">Balance at check-in</dt><dd className="text-right text-primary">{formatRupees(offer.balancePaise)}</dd>
                  </>
                )}
              </dl>
              {offer.peak && fullNow && <p className="mt-3 text-xs text-muted-foreground">{offer.peak} stays are paid in full at booking.</p>}
            </section>

            {!offer.available ? (
              <section className="mt-5 rounded-2xl border border-terracotta/40 bg-terracotta/5 p-5 text-sm text-terracotta" data-testid="offer-taken">
                <p>Sorry, these dates have just been taken.</p>
                {offer.nextFree.length > 0 && (
                  <p className="mt-2">Next free for the same length of stay: {offer.nextFree.slice(0, 3).map((w) => `${pretty(w.startDate)} – ${pretty(w.endDate)}`).join('; ')}.</p>
                )}
                <a href={WHATSAPP} className="mt-3 inline-flex items-center gap-2 font-bold underline"><WhatsappIcon /> Message us for new dates</a>
              </section>
            ) : !offer.ready ? (
              <section className="mt-5 rounded-2xl border border-border bg-card p-5 text-sm text-primary">
                <p>Online booking is paused for a moment. Message us and we will confirm these dates for you.</p>
                <a href={WHATSAPP} className="mt-3 inline-flex items-center gap-2 font-bold underline"><WhatsappIcon /> WhatsApp us</a>
              </section>
            ) : (
              <form className="mt-5 rounded-2xl border border-border bg-card p-5" onSubmit={hold} data-testid="form-offer">
                <div className="grid gap-3">
                  <label>
                    <span className={LABEL}>Your name</span>
                    <input required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={INPUT} autoComplete="name" />
                  </label>
                  <p className="text-xs text-muted-foreground">Mobile: {offer.phoneMasked} (from your enquiry)</p>
                  <label>
                    <span className={LABEL}>Email, for your booking PDF (optional)</span>
                    <input type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} autoComplete="email" />
                  </label>
                  <label>
                    <span className={LABEL}>Anything we should know (optional)</span>
                    <textarea rows={2} maxLength={1000} value={requests} onChange={(e) => setRequests(e.target.value)} className={INPUT} />
                  </label>
                  <label className="flex items-start gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" required />
                    <span>
                      I agree to the <a href={`${basePath}/house-rules`} className="underline">house rules</a> and the{' '}
                      <a href={`${basePath}/cancellation-refund-policy`} className="underline">cancellation policy</a>.
                    </span>
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={busy || !agree || name.trim().length < 2}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-sm font-bold text-primary-foreground disabled:opacity-40"
                  data-testid="button-offer-hold"
                >
                  {busy && <SpinnerIcon className="animate-spin" />} Hold dates & pay {formatRupees(offer.advancePaise)}
                </button>
                <p className="mt-2 text-center text-xs text-muted-foreground">Your dates are held while you pay. We confirm as soon as the payment reaches us.</p>
              </form>
            )}

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Questions? <a href={WHATSAPP} className="underline">WhatsApp us</a> or call {CONFIG.hostPhone}.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
