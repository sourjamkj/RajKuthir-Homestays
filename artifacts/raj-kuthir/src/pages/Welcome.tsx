import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Leaf,
  MapPin,
  MessageCircle,
  Phone,
  Wifi,
} from 'lucide-react';

import { CONFIG, basePath, phoneHref } from '@/lib/site';

/**
 * The arrival pack, unlocked with the reservation number from the guest's
 * confirmation.
 *
 * Why this is gated at all: the Wi-Fi password and the trade contacts should
 * not sit on the open internet — the first is a key to the house network, and
 * the second is other people's personal mobile numbers. Why the gate is only
 * this strong: a booking reference is not a secret, so the real protection is
 * that the server stops resolving it after check-out and rate-limits attempts.
 * Nothing here is in the JavaScript bundle; it arrives only after a match.
 */

type GuestContact = { label: string; name: string; phone: string };

type GuestInfo = {
  wifiSsid: string;
  wifiPassword: string;
  arrival: string;
  contacts: GuestContact[];
};

type GuestBooking = {
  reference: string;
  guestName: string | null;
  checkIn: string;
  checkOut: string;
  guests: number | null;
  source: string;
};

type LookupResponse = { booking: GuestBooking; info: GuestInfo };

/** National helplines. Public information, so they need no owner data entry. */
const EMERGENCY = [
  { label: 'All emergencies', number: '112' },
  { label: 'Police', number: '100' },
  { label: 'Fire', number: '101' },
  { label: 'Ambulance', number: '102' },
  { label: 'Women’s helpline', number: '1091' },
];

const whatsappUrl = `https://wa.me/${CONFIG.hostPhone.replace(/\D/g, '')}`;

const prettyDate = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${iso}T00:00:00`));

/** First name only — "Welcome, Sourja" reads better than the full booking name. */
const firstName = (name: string | null) => (name ?? '').trim().split(/\s+/)[0] || '';

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is blocked in some in-app browsers. The value is
      // visible on screen either way, so a failed copy is not worth an error.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-primary-foreground/25 px-3 py-2 text-[10px] font-bold uppercase tracking-[.1em] text-primary-foreground/90 transition-colors hover:bg-primary-foreground/10"
      aria-label={`Copy ${label}`}
      data-testid={`button-copy-${label.toLowerCase().replace(/\s/g, '-')}`}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function Welcome() {
  const [reference, setReference] = useState('');
  const [data, setData] = useState<LookupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const previous = document.title;
    document.title = 'Your stay | Raj Kuthir Homestays';

    // Keep the unlock page out of search results. It is not a secret — the
    // gate is the reference — but there is no reason to index it.
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);

    return () => {
      document.title = previous;
      meta.remove();
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference }),
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body?.error ?? 'Something went wrong. Please try again.');
        setData(null);
      } else {
        setData(body as LookupResponse);
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const info = data?.info;
  const booking = data?.booking;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-foreground/10 bg-background/90">
        <div className="section-shell flex h-[74px] items-center justify-between gap-6">
          <a href={`${basePath}/`} className="flex shrink-0 items-center gap-3" data-testid="link-welcome-brand">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground">
              <Leaf size={19} strokeWidth={1.7} />
            </span>
            <span className="leading-none">
              <span className="block font-mono-ui text-[10px] font-medium tracking-[.18em] text-muted-foreground">RAJ KUTHIR</span>
              <span className="font-journal text-[19px] text-primary">Homestays</span>
            </span>
          </a>
          <a
            href={`${basePath}/`}
            className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground transition-colors hover:text-primary"
            data-testid="link-welcome-back"
          >
            <ArrowLeft size={15} /> Back to the stay
          </a>
        </div>
      </header>

      <main className="section-shell py-16 md:py-24">
        {!booking && (
          <div className="max-w-[560px]">
            <p className="eyebrow mb-6 text-accent">Guests only</p>
            <h1 className="font-journal text-[clamp(2.8rem,7vw,4.8rem)] leading-[.94] tracking-[-.03em] text-primary">
              Everything you<br /><em className="text-accent">need on arrival.</em>
            </h1>
            <p className="mt-8 text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              Enter the booking reference from your confirmation and we will show you how to find us,
              the Wi-Fi, and who to call for what. It works from the day you book until you check out.
            </p>

            <form onSubmit={submit} className="mt-10" data-testid="form-guest-lookup">
              <label className="block">
                <span className="eyebrow text-muted-foreground">Booking reference</span>
                <input
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="e.g. 1234567890 or HMABC1234"
                  className="mt-2 w-full border-b border-border bg-transparent px-0 py-3 font-mono-ui text-lg tracking-[.06em] text-primary outline-none placeholder:text-muted-foreground/50 focus:border-primary"
                  data-testid="input-booking-reference"
                />
              </label>

              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                It is on your Booking.com, Airbnb or MakeMyTrip confirmation. Spaces and dashes do not matter.
              </p>

              {error && (
                <div className="mt-6 flex items-start gap-3 rounded-[1.1rem] border border-accent/40 bg-accent/10 px-5 py-4" role="alert" data-testid="status-lookup-error">
                  <AlertCircle size={17} className="mt-0.5 shrink-0 text-accent" />
                  <p className="text-sm leading-6 text-primary">{error}</p>
                </div>
              )}

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-3 rounded-full bg-primary px-6 py-4 text-xs font-bold uppercase tracking-[.12em] text-primary-foreground transition-transform hover:-translate-y-0.5 active:scale-95 disabled:opacity-60"
                  data-testid="button-guest-lookup"
                >
                  {loading ? 'Checking…' : 'Show my details'} <ArrowRight size={15} />
                </button>
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 px-2 py-3 text-xs font-bold uppercase tracking-[.12em] text-primary"
                  data-testid="link-welcome-whatsapp"
                >
                  <MessageCircle size={15} /> Ask the host
                </a>
              </div>
            </form>
          </div>
        )}

        {booking && info && (
          <div data-testid="guest-pack">
            <p className="eyebrow mb-5 text-accent">Your stay</p>
            <h1 className="font-journal text-[clamp(2.6rem,6vw,4.4rem)] leading-[.95] tracking-[-.03em] text-primary">
              {firstName(booking.guestName) ? <>Welcome, <em className="text-accent">{firstName(booking.guestName)}</em>.</> : <>You are all <em className="text-accent">set.</em></>}
            </h1>
            <p className="mt-6 text-[15px] leading-7 text-muted-foreground md:text-[17px]">
              {prettyDate(booking.checkIn)} to {prettyDate(booking.checkOut)}
              {booking.guests ? ` · ${booking.guests} guest${booking.guests === 1 ? '' : 's'}` : ''}
              {' · check-in from 12:00 PM, check-out by 11:00 AM'}
            </p>

            <div className="mt-12 grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
              <div className="space-y-5">
                {info.arrival && (
                  <div className="rounded-[1.4rem] border border-border bg-card p-7 md:p-8">
                    <MapPin size={22} className="text-accent" strokeWidth={1.4} />
                    <p className="mt-5 font-journal text-3xl text-primary">Finding us</p>
                    {/* Owner-entered free text: newlines are meaningful, HTML is not. */}
                    <p className="mt-4 whitespace-pre-line text-sm leading-7 text-muted-foreground">{info.arrival}</p>
                    <a
                      href={CONFIG.mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-6 inline-flex items-center gap-2 rounded-full bg-secondary px-5 py-3 text-xs font-bold uppercase tracking-[.1em] text-primary"
                      data-testid="link-welcome-directions"
                    >
                      Open directions <ArrowRight size={14} />
                    </a>
                  </div>
                )}

                {info.contacts.length > 0 && (
                  <div className="rounded-[1.4rem] border border-border bg-card p-7 md:p-8">
                    <Phone size={22} className="text-accent" strokeWidth={1.4} />
                    <p className="mt-5 font-journal text-3xl text-primary">Who to call</p>
                    <div className="mt-6 divide-y divide-border">
                      {info.contacts.map((contact) => (
                        <a
                          key={`${contact.label}-${contact.phone}`}
                          href={phoneHref(contact.phone)}
                          className="flex items-center justify-between gap-4 py-4 transition-colors hover:text-accent"
                          data-testid={`link-contact-${contact.label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
                        >
                          <div>
                            <p className="text-sm font-bold text-primary">{contact.label}</p>
                            {contact.name && <p className="mt-0.5 text-xs text-muted-foreground">{contact.name}</p>}
                          </div>
                          <p className="shrink-0 font-mono-ui text-sm text-accent">{contact.phone}</p>
                        </a>
                      ))}
                    </div>
                    <p className="mt-5 text-xs leading-5 text-muted-foreground">
                      Please keep these for your stay rather than sharing them on — they are personal numbers.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-5">
                {(info.wifiSsid || info.wifiPassword) && (
                  <div className="rounded-[1.4rem] bg-primary p-7 text-primary-foreground md:p-8">
                    <Wifi size={22} className="text-secondary" strokeWidth={1.4} />
                    <p className="mt-5 font-journal text-3xl">Wi-Fi</p>
                    <div className="mt-6 space-y-4">
                      {info.wifiSsid && (
                        <div>
                          <p className="font-mono-ui text-[10px] uppercase tracking-[.14em] text-primary-foreground/60">Network</p>
                          <div className="mt-2 flex items-center justify-between gap-3">
                            <p className="break-all font-mono-ui text-lg">{info.wifiSsid}</p>
                            <CopyButton value={info.wifiSsid} label="network" />
                          </div>
                        </div>
                      )}
                      {info.wifiPassword && (
                        <div className="border-t border-primary-foreground/15 pt-4">
                          <p className="font-mono-ui text-[10px] uppercase tracking-[.14em] text-primary-foreground/60">Password</p>
                          <div className="mt-2 flex items-center justify-between gap-3">
                            <p className="break-all font-mono-ui text-lg" data-testid="text-wifi-password">{info.wifiPassword}</p>
                            <CopyButton value={info.wifiPassword} label="password" />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="rounded-[1.4rem] border border-border bg-card p-7 md:p-8">
                  <p className="eyebrow text-accent">In an emergency</p>
                  <p className="mt-4 text-sm leading-6 text-muted-foreground">
                    Call the caretaker or the host first — they are closest. For anything urgent, these are the national helplines.
                  </p>
                  <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3">
                    {EMERGENCY.map((entry) => (
                      <a key={entry.number} href={phoneHref(entry.number)} className="flex items-baseline justify-between gap-2 border-t border-border pt-3">
                        <span className="text-xs text-muted-foreground">{entry.label}</span>
                        <span className="font-mono-ui text-base font-bold text-primary">{entry.number}</span>
                      </a>
                    ))}
                  </div>
                </div>

                <div className="rounded-[1.4rem] border border-border bg-background p-7 md:p-8">
                  <p className="font-journal text-2xl text-primary">House rules</p>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    Worth a two-minute read before you settle in.
                  </p>
                  <a
                    href={`${basePath}/house-rules`}
                    className="mt-5 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em] text-primary underline decoration-accent decoration-2 underline-offset-4"
                    data-testid="link-welcome-house-rules"
                  >
                    Read the house rules <ArrowRight size={14} />
                  </a>
                </div>
              </div>
            </div>

            <div className="mt-12 flex flex-wrap items-center gap-4 border-t border-border pt-8">
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-full bg-primary px-6 py-4 text-xs font-bold uppercase tracking-[.12em] text-primary-foreground"
                data-testid="link-pack-whatsapp"
              >
                <MessageCircle size={15} /> Message the host
              </a>
              <button
                type="button"
                onClick={() => {
                  setData(null);
                  setReference('');
                }}
                className="px-2 py-3 text-xs font-bold uppercase tracking-[.12em] text-muted-foreground transition-colors hover:text-primary"
                data-testid="button-guest-reset"
              >
                Look up a different booking
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
