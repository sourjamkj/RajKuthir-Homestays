import { useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircleIcon, SpinnerIcon } from '@/components/icons';
import { CONFIG, phoneHref } from '@/lib/site';

/**
 * The complaints & suggestions book the West Bengal Homestay Policy asks a
 * registered homestay to keep, online. The notice board in the house points
 * here with a QR code. Entries go to the owner console (/admin/compliance),
 * where each can be marked resolved with what was done.
 *
 * Not indexed and not in the sitemap: it is for guests who are, or were,
 * staying — not a landing page.
 */

const KINDS = [
  { value: 'complaint', label: 'Complaint' },
  { value: 'suggestion', label: 'Suggestion' },
  { value: 'compliment', label: 'Compliment' },
] as const;

type Kind = (typeof KINDS)[number]['value'];

const field = 'mt-2 w-full border-b border-border bg-transparent py-3 text-base outline-none focus:border-primary';

export default function Feedback() {
  const [kind, setKind] = useState<Kind>('suggestion');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [stayRef, setStayRef] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, name, contact, stayRef, message, website }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? 'Could not send. Please try again, or WhatsApp us.');
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send. Please try again, or WhatsApp us.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell>
      <div className="max-w-[640px]">
        <p className="eyebrow text-muted-foreground">Complaints &amp; suggestions book</p>
        <h1 className="mt-3 font-journal text-4xl text-primary md:text-5xl">Tell us how it went.</h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Something not right, an idea, or a kind word — it all comes straight to the host, Sourja. If you need help
          right now during your stay, call or WhatsApp{' '}
          <a href={phoneHref(CONFIG.hostPhone)} className="font-semibold text-primary underline underline-offset-2">{CONFIG.hostPhone}</a>{' '}
          instead.
        </p>

        {saved ? (
          <div className="mt-8 rounded-2xl border border-olive/40 bg-olive/10 p-7" data-testid="text-feedback-saved">
            <CheckCircleIcon size="md" className="text-olive-ink" />
            <h2 className="mt-4 font-journal text-3xl text-primary">Thank you, it is in the book.</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {kind === 'complaint'
                ? 'We read every complaint and will get back to you if you left a phone number or email.'
                : 'We read every entry. Thank you for taking the time.'}
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-6" data-testid="form-feedback">
            <fieldset>
              <legend className="eyebrow text-muted-foreground">This is a</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {KINDS.map((k) => (
                  <label
                    key={k.value}
                    className={`cursor-pointer rounded-full border px-4 py-2 text-sm font-medium transition-colors ${kind === k.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-primary hover:border-primary'}`}
                  >
                    <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} className="sr-only" />
                    {k.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="eyebrow text-muted-foreground">Your name</span>
              <input id="feedback-name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={field} />
            </label>
            <label className="block">
              <span className="eyebrow text-muted-foreground">Phone or email, if you would like a reply (optional)</span>
              <input id="feedback-contact" maxLength={120} value={contact} onChange={(e) => setContact(e.target.value)} className={field} />
            </label>
            <label className="block">
              <span className="eyebrow text-muted-foreground">Booking reference or stay dates (optional)</span>
              <input id="feedback-stay" maxLength={40} value={stayRef} onChange={(e) => setStayRef(e.target.value)} placeholder="RK-26DEC-… or 26–28 Dec" className={field} />
            </label>
            <label className="block">
              <span className="eyebrow text-muted-foreground">What would you like to tell us?</span>
              <textarea id="feedback-message" required minLength={10} maxLength={4000} rows={6} value={message} onChange={(e) => setMessage(e.target.value)} className="mt-2 w-full rounded-xl border border-border bg-transparent p-3 text-sm outline-none focus:border-primary" />
            </label>
            {/* Honeypot: hidden from people, filled in by bots. */}
            <label className="hidden" aria-hidden="true">
              Website
              <input id="feedback-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
            {error && <p className="text-sm text-terracotta" role="alert">{error}</p>}
            <button disabled={saving} className="flex items-center gap-3 rounded-full bg-primary px-6 py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-feedback-submit">
              {saving ? <SpinnerIcon className="animate-spin" /> : <CheckCircleIcon />} Add to the book
            </button>
          </form>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-foreground/10">
        <div className="mx-auto max-w-[1180px] px-5 py-5">
          <a href="/" className="font-mono-ui text-xs tracking-[.18em] text-muted-foreground">RAJ KUTHIR HOMESTAYS</a>
          <span className="ml-2 font-journal text-xl text-primary">Sobuj Potro</span>
        </div>
      </header>
      <main className="mx-auto max-w-[1180px] px-5 py-12 md:py-20">{children}</main>
    </div>
  );
}
