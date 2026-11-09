import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AlertIcon, CheckCircleIcon, SpinnerIcon, UploadIcon } from '@/components/icons';
import { ID_TYPES, UPLOAD_INSTRUCTIONS, extraGuestPerNightPaise, requiredSides, type ExtraGuestRates, type IdTypeKey } from '@/lib/id-upload';
import { MAX_TOTAL_BYTES, blobToBase64, checkIdPhoto, sizeText, type PhotoCheck } from '@/lib/id-photo-check';

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

type PartyGuest = { slot: number; name: string; age: 'adult' | 'child'; idType: IdTypeKey };
type Lookup = {
  booking: { reference: string | null; guestName: string | null; guestPhone: string | null; checkIn: string; checkOut: string; guests: number | null; pets: number | null };
  verificationDeadline: string;
  deadlinePassed: boolean;
  status: string;
  /** Set when the owner turned down the last upload; the reason is shown here. */
  rejection?: { reason: string | null } | null;
  party?: {
    booked: number;
    maxCards: number;
    accepted: PartyGuest[];
    rejected: Array<PartyGuest & { reason: string | null }>;
    extraRates: ExtraGuestRates | null;
  };
};

/*
 * Photos are checked and made smaller on the phone (id-photo-check.ts); the
 * server requires its MIME allowlist and checks the bytes match it.
 */
const DOCUMENT_ACCEPT = 'image/*,application/pdf,.pdf';

type SlotFile = { checking: true } | PhotoCheck;
type Card = { slot: number; name: string; age: 'adult' | 'child'; idType: IdTypeKey; foreign: boolean; files: Record<string, SlotFile>; reason?: string | null; added?: boolean };

const blankCard = (slot: number, name = '', added = false): Card => ({ slot, name, age: 'adult', idType: 'aadhaar', foreign: false, files: {}, added });

function nightsBetween(a: string, b: string): number {
  return Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000));
}

/** Problems that stop this card going up, by side; empty when the card is complete. */
function cardProblems(card: Card, allCards: Card[]): { complete: boolean; dupes: Record<string, string> } {
  const dupes: Record<string, string> = {};
  const sides = requiredSides(card.idType, card.foreign);
  for (const side of sides) {
    const file = card.files[side];
    if (!file || !('ok' in file) || !file.ok) continue;
    for (const other of allCards) {
      for (const [otherSide, otherFile] of Object.entries(other.files)) {
        if (other === card && otherSide === side) continue;
        if (!requiredSides(other.idType, other.foreign).includes(otherSide)) continue;
        if (otherFile && 'ok' in otherFile && otherFile.ok && otherFile.hash === file.hash) {
          dupes[side] = other === card ? `This is the same file as the ${otherSide.toLowerCase()}. Add the other side.` : `This file is already used for Guest ${other.slot}. Each guest needs their own ID.`;
        }
      }
    }
  }
  const complete = Boolean(card.name.trim()) && sides.every((side) => {
    const file = card.files[side];
    return file && 'ok' in file && file.ok && !dupes[side];
  });
  return { complete, dupes };
}

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
  // Nationality decides whether a Form C is needed (foreign guests, within
  // 24 hours of arrival), so it is asked for rather than guessed.
  const [country, setCountry] = useState('India');
  const foreignGuest = !/^\s*(india|indian|bharat|in)\s*$/i.test(country) && country.trim() !== '';
  const [cards, setCards] = useState<Card[]>([]);

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
      .then((data) => {
        setLookup(data);
        setName(data.booking.guestName ?? '');
        setPhone(data.booking.guestPhone ?? '');
        const booked = Math.max(1, data.party?.booked ?? data.booking.guests ?? 1);
        const accepted = new Set((data.party?.accepted ?? []).map((g) => g.slot));
        const rejected = new Map((data.party?.rejected ?? []).map((g) => [g.slot, g]));
        // One card per guest still to do: the rejected ones (with the reason),
        // then any booked guest not yet uploaded. Accepted guests stay locked.
        const todo: Card[] = [];
        const slots = new Set<number>([...Array.from({ length: booked }, (_, i) => i + 1), ...rejected.keys()]);
        for (const slot of [...slots].sort((a, b) => a - b)) {
          if (accepted.has(slot)) continue;
          const r = rejected.get(slot);
          todo.push(r
            ? { ...blankCard(slot, r.name), age: r.age, idType: r.idType, reason: r.reason, added: slot > booked }
            : blankCard(slot, slot === 1 && accepted.size === 0 ? data.booking.guestName ?? '' : ''));
        }
        setCards(todo);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'This link is unavailable.'));
    return () => meta.remove();
  }, [token]);

  const update = (slot: number, change: (card: Card) => Card) => setCards((all) => all.map((c) => (c.slot === slot ? change(c) : c)));

  const addFile = async (slot: number, side: string, file: File | undefined) => {
    if (!file) return;
    update(slot, (c) => ({ ...c, files: { ...c.files, [side]: { checking: true } } }));
    const result = await checkIdPhoto(file);
    update(slot, (c) => ({ ...c, files: { ...c.files, [side]: result } }));
  };

  const accepted = lookup?.party?.accepted ?? [];
  const booked = Math.max(1, lookup?.party?.booked ?? lookup?.booking.guests ?? 1);
  const maxCards = lookup?.party?.maxCards ?? booked;
  const listed = accepted.length + cards.length;
  const status = useMemo(() => cards.map((c) => cardProblems(c, cards)), [cards]);
  const doneCount = status.filter((s) => s.complete).length;
  const totalBytes = cards.reduce((n, c) => n + requiredSides(c.idType, c.foreign).reduce((m, side) => {
    const f = c.files[side];
    return m + (f && 'ok' in f && f.ok ? f.blob.size : 0);
  }, 0), 0);
  const tooBig = totalBytes > MAX_TOTAL_BYTES;
  const ready = cards.length > 0 && doneCount === cards.length && !tooBig;
  const nights = lookup ? nightsBetween(lookup.booking.checkIn, lookup.booking.checkOut) : 1;
  const extraPerNight = lookup?.party?.extraRates ? extraGuestPerNightPaise(booked, listed, lookup.party.extraRates) : 0;

  const addGuest = () => {
    const used = new Set([...accepted.map((g) => g.slot), ...cards.map((c) => c.slot)]);
    let slot = 1;
    while (used.has(slot)) slot += 1;
    setCards((all) => [...all, blankCard(slot, '', true)]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!lookup || saving || !ready) return;
    setSaving(true); setError(null);
    try {
      const guests = await Promise.all(cards.map(async (c) => ({
        slot: c.slot,
        name: c.name.trim(),
        age: c.age,
        idType: c.idType,
        foreign: c.foreign,
        files: await Promise.all(requiredSides(c.idType, c.foreign).map(async (side) => {
          const f = c.files[side] as Extract<PhotoCheck, { ok: true }>;
          return { side, originalFilename: f.filename, mimeType: f.mimeType, dataBase64: await blobToBase64(f.blob) };
        })),
      })));
      const response = await fetch('/api/guest/onboarding/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, fullName: name, phone, email, address, country, guests }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? 'Could not save your verification.');
      setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save your verification.'); }
    finally { setSaving(false); }
  };

  if (error && !lookup) return <Shell><div className="rounded-2xl border border-border bg-card p-7"><AlertIcon size="md" className="text-accent" /><h1 className="mt-4 font-journal text-3xl text-primary">Verification link unavailable</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">{error}</p></div></Shell>;
  if (!lookup) return <Shell><SpinnerIcon size="md" className="animate-spin text-primary" /></Shell>;

  const deadline = new Date(lookup.verificationDeadline);
  const deadlinePassed = lookup.deadlinePassed || lookup.status === 'blocked';
  const fixing = accepted.length > 0;
  // On a re-upload the contact details are already on file; ask only if missing.
  const needContact = !fixing || !lookup.booking.guestPhone || !lookup.booking.guestName;
  const inputLine = 'mt-2 w-full border-b border-border bg-transparent py-3 text-base focus:border-primary';
  return <Shell>
    <div className="max-w-[720px]">
      <p className="eyebrow text-accent">Mandatory pre-arrival check-in</p>
      <h1 className="mt-4 font-journal text-[clamp(2.6rem,6vw,4.4rem)] leading-[.95] text-primary">Verify your <em className="text-accent">stay.</em></h1>
      <p className="mt-6 text-sm leading-7 text-muted-foreground">Please add one photo ID for each guest staying at Raj Kuthir Homestays – Sobuj Potro. Photos are checked on your phone first, so you can retake any that will not be accepted.</p>

      <div className="mt-7 rounded-2xl border border-terracotta/40 bg-terracotta/10 p-5">
        <div className="flex gap-3"><div><p className="font-bold text-primary">Complete at least 48 hours before check-in</p><p className="mt-1 text-sm leading-6 text-muted-foreground">Deadline: <strong>{deadline.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}</strong>.</p><p className="mt-2 text-sm font-semibold text-terracotta">{deadlinePassed ? 'The verification deadline has passed. Check-in is blocked until the property team reviews the booking.' : 'Failure to complete mandatory verification may result in check-in being denied without refund, in accordance with the booking terms.'}</p></div></div>
      </div>

      <div className="mt-7 rounded-2xl border border-border bg-card p-5 text-sm"><p className="font-medium text-primary">{lookup.booking.guestName ?? 'Guest'}</p><p className="mt-1 text-muted-foreground">{lookup.booking.checkIn} → {lookup.booking.checkOut} · {booked} guest{booked === 1 ? '' : 's'}{lookup.booking.pets ? ` · ${lookup.booking.pets} pet${lookup.booking.pets === 1 ? '' : 's'}` : ''}</p></div>

      {deadlinePassed && !saved ? <div className="mt-7 rounded-2xl border border-terracotta/40 bg-terracotta/10 p-7"><AlertIcon size="md" className="text-terracotta" /><h2 className="mt-4 font-journal text-3xl text-primary">Verification deadline passed.</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">The mandatory 48-hour verification window has closed. Please contact the property team; they will review your booking and advise you on the next step.</p></div> : saved ? <div className="mt-7 rounded-2xl border border-olive/40 bg-olive/10 p-7"><CheckCircleIcon size="md" className="text-olive-ink" /><h2 className="mt-4 font-journal text-3xl text-primary">Verification submitted.</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Thank you. Your documents have been submitted for review. Please keep your phone available in case the property team needs clarification.</p></div> : <form onSubmit={submit} className="mt-7 space-y-6">
        {lookup.rejection && <div className="rounded-2xl border border-terracotta/40 bg-terracotta/10 p-5" role="alert" data-testid="text-prearrival-rejected"><p className="font-bold text-primary">{fixing ? 'Some IDs need to be uploaded again' : 'Your earlier upload was not accepted'}</p>{!fixing && <p className="mt-1 text-sm leading-6 text-terracotta">Reason: {lookup.rejection.reason || 'The documents could not be verified.'}</p>}<p className="mt-2 text-sm leading-6 text-muted-foreground">{fixing ? 'Only the guests below need a new upload. The others are already accepted.' : 'Please upload again, following the checklist below.'}</p></div>}

        {needContact && <>
          <label className="block"><span className="eyebrow text-muted-foreground">Your full name (booking contact)</span><input required value={name} onChange={e=>setName(e.target.value)} className={inputLine}/></label>
          <label className="block"><span className="eyebrow text-muted-foreground">Mobile number</span><input required type="tel" value={phone} onChange={e=>setPhone(e.target.value)} className={inputLine}/></label>
          <label className="block"><span className="eyebrow text-muted-foreground">Email (optional)</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)} className={inputLine}/></label>
          <label className="block"><span className="eyebrow text-muted-foreground">Address (optional)</span><textarea value={address} onChange={e=>setAddress(e.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-border bg-transparent p-3 text-sm focus:border-primary"/></label>
          <label className="block"><span className="eyebrow text-muted-foreground">Nationality</span><input required value={country} onChange={e=>setCountry(e.target.value)} autoComplete="country-name" className={inputLine} data-testid="input-prearrival-country"/></label>
          {foreignGuest && <p className="rounded-xl border border-border bg-card p-4 text-sm leading-6 text-muted-foreground" data-testid="text-prearrival-foreign">For guests who are not Indian nationals, please upload the photo page of your passport and your Indian visa. We file the Form C with the Foreigners Regional Registration Office within 24 hours of arrival, as the law requires.</p>}
        </>}

        <details className="rounded-2xl border border-border bg-card p-5" open><summary className="cursor-pointer text-sm font-semibold text-primary">How to upload</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground" data-testid="list-prearrival-instructions">{UPLOAD_INSTRUCTIONS.map((line) => <li key={line}>{line}</li>)}</ul></details>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-semibold text-primary">{doneCount} of {cards.length} guest{cards.length === 1 ? '' : 's'} ready</span><span className="text-muted-foreground">Booked for {booked} · {listed} listed</span></div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full bg-primary transition-all" style={{ width: `${cards.length ? (100 * doneCount) / cards.length : 0}%` }} /></div>
        </div>

        {accepted.map((g) => <div key={`ok-${g.slot}`} className="flex items-center justify-between gap-3 rounded-2xl border border-olive/50 bg-olive/10 px-5 py-4 text-sm" data-testid={`card-accepted-${g.slot}`}><span><span className="font-mono-ui text-xs text-muted-foreground">GUEST {g.slot}</span> <span className="ml-2 font-medium text-primary">{g.name}</span> <span className="text-muted-foreground">· {ID_TYPES[g.idType]?.label ?? 'ID'}</span></span><span className="flex items-center gap-1 font-semibold text-olive-ink"><CheckCircleIcon /> Accepted</span></div>)}

        {cards.map((card, index) => {
          const { complete, dupes } = status[index]!;
          const types = (Object.entries(ID_TYPES) as Array<[IdTypeKey, (typeof ID_TYPES)[IdTypeKey]]>).filter(([, t]) => (card.age === 'child' ? t.child : t.adult));
          return <fieldset key={card.slot} className={`space-y-4 rounded-2xl border bg-card p-5 ${complete ? 'border-olive/60' : 'border-border'}`} data-testid={`card-guest-${card.slot}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <legend className="contents"><span className="font-mono-ui text-xs text-muted-foreground">GUEST {card.slot}{card.added ? ' · EXTRA' : ''}</span></legend>
              <span className="flex items-center gap-2">{complete ? <span className="rounded-full bg-olive/15 px-2.5 py-1 text-[11px] font-bold text-olive-ink">Ready</span> : <span className="rounded-full bg-terracotta/10 px-2.5 py-1 text-[11px] font-bold text-terracotta">Needs ID</span>}{card.added && !card.reason && <button type="button" onClick={() => setCards((all) => all.filter((c) => c.slot !== card.slot))} className="text-xs font-semibold text-muted-foreground underline">Remove</button>}</span>
            </div>
            {card.reason && <p className="rounded-xl bg-terracotta/10 p-3 text-sm text-terracotta" role="alert">Not accepted: {card.reason}</p>}
            <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
              <label className="block min-w-0"><span className="eyebrow text-muted-foreground">Full name as on the ID</span><input required value={card.name} onChange={(e) => update(card.slot, (c) => ({ ...c, name: e.target.value }))} className={inputLine} data-testid={`input-guest-name-${card.slot}`}/></label>
              <label className="block"><span className="eyebrow text-muted-foreground">Guest is</span><select value={card.age} onChange={(e) => update(card.slot, (c) => { const age = e.target.value as Card['age']; const ok = age === 'child' ? ID_TYPES[c.idType].child : ID_TYPES[c.idType].adult; return { ...c, age, ...(ok ? {} : { idType: age === 'child' ? 'school' : 'aadhaar', files: {} }) }; })} className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm"><option value="adult">Adult</option><option value="child">Child (under 18)</option></select></label>
              <label className="block"><span className="eyebrow text-muted-foreground">ID type</span><select value={card.idType} onChange={(e) => update(card.slot, (c) => ({ ...c, idType: e.target.value as IdTypeKey, files: {} }))} className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm" data-testid={`select-id-type-${card.slot}`}>{types.map(([key, t]) => <option key={key} value={key}>{t.label}</option>)}</select></label>
            </div>
            {card.idType === 'passport' && <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={card.foreign} onChange={(e) => update(card.slot, (c) => ({ ...c, foreign: e.target.checked }))}/> Not an Indian national (add the visa page)</label>}
            <div className="grid gap-3 sm:grid-cols-2">
              {requiredSides(card.idType, card.foreign).map((side) => {
                const file = card.files[side];
                const checking = Boolean(file && 'checking' in file);
                const ok = file && 'ok' in file && file.ok && !dupes[side];
                const bad = file && 'ok' in file && (!file.ok || dupes[side]);
                const preview = file && 'previewUrl' in file ? file.previewUrl : null;
                const inputId = `id-${card.slot}-${side.replace(/\W/g, '')}`;
                return <div key={side} className={`min-w-0 space-y-2 rounded-xl border p-3 ${ok ? 'border-olive/60' : bad ? 'border-terracotta/60' : 'border-dashed border-border'}`}>
                  <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-primary">{side}</span>{file && !checking && <label htmlFor={inputId} className="cursor-pointer text-xs font-semibold text-muted-foreground underline">Retake</label>}</div>
                  {preview && <img src={preview} alt={`${side} of ${card.name || `guest ${card.slot}`}'s ID`} className="aspect-[1.6] w-full max-w-full rounded-lg object-cover"/>}
                  {checking ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><SpinnerIcon className="animate-spin"/> Checking the photo…</p>
                    : file && 'ok' in file ? <p className={`text-xs leading-5 ${ok ? 'text-olive-ink' : 'text-terracotta'}`} role={bad ? 'alert' : undefined}>{dupes[side] ?? (file.ok ? file.warn ?? file.note : file.message)}</p>
                    : <label htmlFor={inputId} className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-border px-3 py-4 text-[13px] font-medium text-primary hover:border-primary"><UploadIcon /> Take or choose photo</label>}
                  <input id={inputId} type="file" accept={DOCUMENT_ACCEPT} className="hidden" onChange={(e) => { void addFile(card.slot, side, e.target.files?.[0]); e.target.value = ''; }} data-testid={`input-file-${card.slot}-${side.replace(/\W/g, '')}`}/>
                </div>;
              })}
            </div>
          </fieldset>;
        })}

        {listed < maxCards && <button type="button" onClick={addGuest} className="rounded-full border border-border px-4 py-2.5 text-sm font-semibold text-primary hover:border-primary" data-testid="button-add-guest">+ Someone extra is coming</button>}
        {listed > booked && <p className="rounded-xl border border-terracotta/40 bg-terracotta/10 p-4 text-sm leading-6 text-primary" data-testid="text-extra-guests"><strong>{listed - booked} more guest{listed - booked === 1 ? '' : 's'} than booked.</strong> {extraPerNight > 0 ? `The extra charge is about ₹${(extraPerNight / 100).toLocaleString('en-IN')} a night (₹${((extraPerNight * nights) / 100).toLocaleString('en-IN')} for ${nights} night${nights === 1 ? '' : 's'}), payable at check-in.` : 'Any extra charge is payable at check-in.'} We'll confirm on WhatsApp.</p>}
        {tooBig && <p className="text-sm text-terracotta" role="alert">These files add up to {sizeText(totalBytes)}, more than one upload can carry. Use camera photos instead of large PDFs.</p>}
        {error && <p className="text-sm text-terracotta" role="alert">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={saving || !ready} className="flex items-center gap-3 rounded-full bg-primary px-6 py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-submit-verification">{saving ? <SpinnerIcon className="animate-spin" /> : <CheckCircleIcon />} Submit verification</button>
          {!ready && !tooBig && <span className="text-sm text-muted-foreground">Add a clear ID for every guest to submit ({cards.length - doneCount} left).</span>}
        </div>
      </form>}
    </div>
  </Shell>;
}

function Shell({ children }: { children: ReactNode }) { return <div className="min-h-[100dvh] bg-background text-foreground"><header className="border-b border-foreground/10"><div className="mx-auto max-w-[1180px] px-5 py-5"><span className="font-mono-ui text-xs tracking-[.18em] text-muted-foreground">RAJ KUTHIR HOMESTAYS</span><span className="ml-2 font-journal text-xl text-primary">Sobuj Potro</span></div></header><main className="mx-auto max-w-[1180px] px-5 py-12 md:py-20">{children}</main></div>; }
