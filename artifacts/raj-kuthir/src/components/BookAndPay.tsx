import { useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, CalendarCheck, CircleAlert, Loader2, ShieldCheck } from 'lucide-react';

import { formatRupees, useRatePlan } from '@/lib/rates';
import { basePath, track } from '@/lib/site';

/**
 * Self-serve "Book & Pay by UPI".
 *
 * Every price shown here comes from the server: the ladder line from
 * /api/rates (the same plan the rate card reads) and the stay total from
 * /api/book/quote, which runs the same quoteForEnquiry the owner's quotes
 * use. This file never adds up money. A test fails if a rupee amount is
 * typed into it.
 */

type NightLine = { date: string; paise: number; weekend: boolean; peak: string | null };

type QuoteOk = {
  available: true;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  perNight: NightLine[];
  roomPaise: number;
  extraGuestPaise: number;
  petPaise: number;
  totalPaise: number;
  advancePaise: number;
  balancePaise: number;
  advancePercent: number;
  holdMinutes: number;
  onlineBooking: boolean;
};

type QuoteNo = {
  available: false;
  reason: string;
  nextFree: Array<{ startDate: string; endDate: string }>;
};

const MOBILE_PATTERN = '(\\+?91[- ]?|0)?[6-9][0-9]{9}';

function todayIso(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function pretty(iso: string, withYear = false): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', {
    weekday: withYear ? undefined : 'short',
    day: 'numeric',
    month: 'short',
    year: withYear ? 'numeric' : undefined,
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T;
  return { ok: response.ok, status: response.status, data };
}

export function BookAndPay({ id = 'book-online' }: { id?: string }) {
  const ratePlan = useRatePlan();
  const ladder = ratePlan.data?.ladder;
  const today = todayIso();

  const [stay, setStay] = useState({ checkIn: '', checkOut: '', adults: '2', children: '0', pets: '0' });
  const [guest, setGuest] = useState({ name: '', phone: '', email: '', requests: '' });
  const [quote, setQuote] = useState<QuoteOk | QuoteNo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'quote' | 'start' | 'enquiry' | null>(null);
  const [enquirySent, setEnquirySent] = useState(false);

  const totalGuests = Number(stay.adults || 0) + Number(stay.children || 0);
  const stayNights =
    stay.checkIn && stay.checkOut && stay.checkOut > stay.checkIn
      ? Math.round((Date.parse(stay.checkOut) - Date.parse(stay.checkIn)) / 86_400_000)
      : 0;
  // Larger parties and long stays are confirmed by message, not paid online.
  const enquiryOnly = totalGuests > 5 || stayNights > 30;
  const upcomingPeaks = useMemo(
    () => (ratePlan.data?.peaks ?? []).filter((peak) => peak.endDate > today),
    [ratePlan.data?.peaks, today],
  );

  const update = (field: keyof typeof stay, value: string) => {
    setStay((current) => ({ ...current, [field]: value }));
    setQuote(null);
    setError(null);
    setEnquirySent(false);
  };

  const sendEnquiry = async () => {
    if (!guest.name.trim() || !guest.phone.trim()) {
      setError('Add your name and mobile number so we can reply.');
      return;
    }
    setBusy('enquiry');
    setError(null);
    try {
      const { ok, data } = await postJson<{ error?: string }>('/api/enquiries', {
        name: guest.name,
        phone: guest.phone,
        email: guest.email || null,
        requests: guest.requests || null,
        checkIn: stay.checkIn || null,
        checkOut: stay.checkOut || null,
        adults: stay.adults,
        children: stay.children,
        pets: stay.pets,
      });
      if (ok) {
        setEnquirySent(true);
        track('book_pay_enquiry');
      } else {
        setError(data.error ?? 'Could not send the enquiry.');
      }
    } catch {
      setError('Could not reach the server. Please check your connection.');
    } finally {
      setBusy(null);
    }
  };

  const checkPrice = async (event?: FormEvent, override?: { checkIn: string; checkOut: string }) => {
    event?.preventDefault();
    const dates = override ?? stay;
    if (override) setStay((current) => ({ ...current, ...override }));
    setBusy('quote');
    setError(null);
    try {
      const { ok, data } = await postJson<(QuoteOk | QuoteNo) & { error?: string }>('/api/book/quote', {
        checkIn: dates.checkIn,
        checkOut: dates.checkOut,
        adults: Number(stay.adults),
        children: Number(stay.children),
        pets: Number(stay.pets),
      });
      if (!ok) {
        setError(data.error ?? 'Could not price those dates.');
        setQuote(null);
      } else {
        setQuote(data);
        track('book_pay_quote', { available: data.available });
      }
    } catch {
      setError('Could not reach the server. Please check your connection.');
    } finally {
      setBusy(null);
    }
  };

  const start = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('start');
    setError(null);
    try {
      const { ok, status, data } = await postJson<{ payUrl?: string; error?: string; nextFree?: QuoteNo['nextFree'] }>(
        '/api/book/start',
        {
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
          adults: Number(stay.adults),
          children: Number(stay.children),
          pets: Number(stay.pets),
          ...guest,
        },
      );
      if (ok && data.payUrl) {
        track('book_pay_hold');
        window.location.assign(`${basePath}${data.payUrl}`);
        return;
      }
      if (status === 409) {
        setQuote({ available: false, reason: data.error ?? 'Those dates were just taken.', nextFree: data.nextFree ?? [] });
      } else {
        setError(data.error ?? 'Could not hold those dates.');
      }
    } catch {
      setError('Could not reach the server. Please check your connection.');
    } finally {
      setBusy(null);
    }
  };

  const field =
    'mt-2 w-full border-b border-border bg-transparent px-0 py-3 text-sm text-primary outline-none placeholder:text-muted-foreground/60 focus:border-primary';

  return (
    <section id={id} className="scroll-mt-24 rounded-[1.5rem] border border-primary/15 bg-card p-6 md:p-8" aria-labelledby={`${id}-title`} data-testid="section-book-and-pay">
      <div className="flex flex-col gap-2 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow text-accent">Instant hold · pay by UPI</p>
          <h3 id={`${id}-title`} className="mt-2 font-journal text-3xl text-primary md:text-4xl">Book &amp; pay online</h3>
        </div>
        <CalendarCheck size={22} className="hidden text-accent sm:block" />
      </div>

      {ladder && (
        <p className="mt-4 text-[13px] leading-6 text-primary/75" data-testid="text-book-ladder">
          Sun–Thu <strong>{formatRupees(ladder.weekdayBasePaise)}</strong> · Fri–Sat <strong>{formatRupees(ladder.weekendBasePaise)}</strong> per night
          for up to {ladder.includedGuests} guests, +{formatRupees(ladder.extraGuestPaise)} per extra guest per night (up to 5).
          {ladder.weeklyDiscountPercent > 0 && ` ${ladder.weeklyDiscountPercent}% off stays of ${ladder.weeklyMinNights}+ nights.`}
        </p>
      )}
      {upcomingPeaks.length > 0 && (
        <ul className="mt-2 space-y-1 text-[12px] leading-5 text-muted-foreground" data-testid="list-book-peaks">
          {upcomingPeaks.map((peak) => (
            <li key={peak.id}>
              {peak.label}: {pretty(peak.startDate, true)} – {pretty(addDays(peak.endDate, -1), true)} · {peak.minNights}-night minimum
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={checkPrice} className="mt-6 space-y-5" data-testid="form-book-quote">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="eyebrow text-muted-foreground">Check-in *</span>
            <input id={`${id}-check-in`} required type="date" min={today} value={stay.checkIn} onChange={(e) => update('checkIn', e.target.value)} className={field} data-testid="input-book-check-in" />
          </label>
          <label className="block">
            <span className="eyebrow text-muted-foreground">Check-out *</span>
            <input id={`${id}-check-out`} required type="date" min={stay.checkIn || today} value={stay.checkOut} onChange={(e) => update('checkOut', e.target.value)} className={field} data-testid="input-book-check-out" />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {(['adults', 'children', 'pets'] as const).map((key) => (
            <label key={key} className="block rounded-xl border border-border p-3">
              <span className="text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">{key}</span>
              <input
                id={`${id}-${key}`}
                type="number"
                min={key === 'adults' ? 1 : 0}
                max={key === 'pets' ? 4 : 20}
                required
                value={stay[key]}
                onChange={(e) => update(key, e.target.value)}
                className="mt-1 w-full bg-transparent text-lg font-bold text-primary outline-none"
                data-testid={`input-book-${key}`}
              />
            </label>
          ))}
        </div>
        {enquiryOnly && (
          <p className="rounded-xl bg-secondary/60 px-4 py-3 text-[12px] leading-5 text-primary" data-testid="text-book-enquiry-only">
            {totalGuests > 5 ? `For ${totalGuests} guests` : 'For stays over 30 nights'} we confirm by message — fill in your details below and send an enquiry.
          </p>
        )}
        <button
          type="submit"
          disabled={busy !== null || enquiryOnly || totalGuests < 1}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-primary/25 px-5 py-3.5 text-xs font-bold uppercase tracking-[.11em] text-primary transition-colors hover:bg-primary/5 disabled:opacity-40"
          data-testid="button-book-quote"
        >
          {busy === 'quote' ? <Loader2 size={15} className="animate-spin" /> : null} See price &amp; availability
        </button>
      </form>

      {error && (
        <p className="mt-5 flex items-start gap-2 rounded-xl border border-[#A65E45]/40 bg-[#A65E45]/5 px-4 py-3 text-[13px] leading-6 text-[#A65E45]" role="alert" data-testid="text-book-error">
          <CircleAlert size={15} className="mt-0.5 shrink-0" /> <span>{error}</span>
        </p>
      )}

      {quote && !quote.available && (
        <div className="mt-5 rounded-xl border border-[#A65E45]/40 bg-[#A65E45]/5 p-4 text-[13px] leading-6 text-[#A65E45]" role="alert" data-testid="text-book-unavailable">
          <p className="flex items-start gap-2"><CircleAlert size={15} className="mt-1 shrink-0" /> {quote.reason}</p>
          {quote.nextFree.length > 0 && (
            <div className="mt-3">
              <p className="font-bold text-primary">Next free dates:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {quote.nextFree.map((window) => (
                  <button
                    key={window.startDate}
                    type="button"
                    onClick={() => checkPrice(undefined, { checkIn: window.startDate, checkOut: window.endDate })}
                    className="rounded-full border border-primary/25 bg-background px-3 py-1.5 text-[12px] font-bold text-primary hover:bg-primary/5"
                    data-testid="button-book-next-free"
                  >
                    {pretty(window.startDate)} → {pretty(window.endDate)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {quote && quote.available && (
        <div className="mt-6" data-testid="panel-book-quote">
          <div className="rounded-xl bg-background p-4">
            <ul className="divide-y divide-border text-[13px]" data-testid="list-book-nights">
              {quote.perNight.map((night) => (
                <li key={night.date} className="flex justify-between py-1.5 tabular-nums">
                  <span className="text-primary/80">
                    {pretty(night.date)}
                    {night.peak ? <span className="ml-2 text-[11px] text-accent">{night.peak}</span> : night.weekend ? <span className="ml-2 text-[11px] text-muted-foreground">weekend</span> : null}
                  </span>
                  <span className="text-primary">{formatRupees(night.paise)}</span>
                </li>
              ))}
              {quote.petPaise > 0 && (
                <li className="flex justify-between py-1.5 tabular-nums"><span className="text-primary/80">Pet fee</span><span className="text-primary">{formatRupees(quote.petPaise)}</span></li>
              )}
            </ul>
            <div className="mt-3 flex items-end justify-between border-t border-primary/20 pt-3">
              <span className="text-sm font-bold text-primary">{quote.nights} night{quote.nights === 1 ? '' : 's'} · {quote.guests} guest{quote.guests === 1 ? '' : 's'}</span>
              <span className="font-journal text-3xl text-primary" data-testid="text-book-total">{formatRupees(quote.totalPaise)}</span>
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground tabular-nums">
              <span>Advance now ({quote.advancePercent}%): <strong className="text-primary">{formatRupees(quote.advancePaise)}</strong></span>
              <span>At check-in: {formatRupees(quote.balancePaise)}</span>
            </div>
          </div>
        </div>
      )}

      {enquirySent ? (
        <p className="mt-6 rounded-xl bg-secondary p-4 text-[13px] leading-6 text-primary" role="status" data-testid="text-book-enquiry-sent">
          Enquiry received — we'll reply on WhatsApp shortly with availability and a quote.
        </p>
      ) : ((quote && quote.available) || (enquiryOnly && stayNights > 0)) ? (
        <form onSubmit={start} className="mt-6 space-y-5" data-testid="form-book-start">
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="eyebrow text-muted-foreground">Your name *</span>
                  <input id={`${id}-name`} required minLength={2} maxLength={120} autoComplete="name" value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} className={field} data-testid="input-book-name" />
                </label>
                <label className="block">
                  <span className="eyebrow text-muted-foreground">Mobile *</span>
                  <input id={`${id}-phone`} required type="tel" inputMode="tel" autoComplete="tel" pattern={MOBILE_PATTERN} title="A 10-digit Indian mobile number" value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} className={field} placeholder="98765 43210" data-testid="input-book-phone" />
                </label>
                <label className="block">
                  <span className="eyebrow text-muted-foreground">Email</span>
                  <input id={`${id}-email`} type="email" autoComplete="email" maxLength={200} value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} className={field} data-testid="input-book-email" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="eyebrow text-muted-foreground">Requests</span>
                  <textarea id={`${id}-requests`} rows={2} maxLength={1000} value={guest.requests} onChange={(e) => setGuest({ ...guest, requests: e.target.value })} className={`${field} resize-none`} data-testid="input-book-requests" />
                </label>
              </div>
          {quote && quote.available && quote.onlineBooking && !enquiryOnly && (
            <button
              type="submit"
              disabled={busy !== null}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-4 text-xs font-bold uppercase tracking-[.11em] text-primary-foreground transition-transform hover:-translate-y-0.5 active:scale-95 disabled:opacity-40"
              data-testid="button-book-start"
            >
              {busy === 'start' ? <Loader2 size={15} className="animate-spin" /> : null}
              Hold dates &amp; pay {formatRupees(quote.advancePaise)} <ArrowRight size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={sendEnquiry}
            disabled={busy !== null}
            className={
              quote && quote.available && quote.onlineBooking && !enquiryOnly
                ? 'flex w-full items-center justify-center gap-2 rounded-full border border-primary/25 px-5 py-3 text-xs font-bold uppercase tracking-[.11em] text-primary hover:bg-primary/5 disabled:opacity-40'
                : 'flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-4 text-xs font-bold uppercase tracking-[.11em] text-primary-foreground disabled:opacity-40'
            }
            data-testid="button-book-enquiry"
          >
            {busy === 'enquiry' ? <Loader2 size={15} className="animate-spin" /> : null}
            {quote && quote.available && quote.onlineBooking && !enquiryOnly ? 'Just send an enquiry' : 'Send enquiry'}
          </button>
          <p className="flex items-start gap-2 text-[11px] leading-5 text-muted-foreground">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-accent" />
            {quote && quote.available && quote.onlineBooking && !enquiryOnly
              ? `Paying holds these dates for ${quote.holdMinutes} minutes; we confirm as soon as we see the payment. `
              : 'We reply on WhatsApp with availability and a quote. '}
            By booking or enquiring you agree to our{' '}
            <a href={`${basePath}/house-rules`} className="underline decoration-accent underline-offset-2">house rules</a>.
          </p>
        </form>
      ) : null}
    </section>
  );
}

function addDays(iso: string, days: number): string {
  const at = new Date(`${iso}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
