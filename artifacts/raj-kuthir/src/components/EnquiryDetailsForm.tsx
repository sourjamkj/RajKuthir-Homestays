import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

/**
 * The enquiry form for adding a lead by hand and for editing one: who is
 * coming (adults, children and their ages, pets), what they asked for, a
 * private note, and the price agreed with the guest. The agreed price, when
 * set, is what the quote, the WhatsApp reply and "Book with my details" use
 * instead of the rate card. The phone app has the same fields.
 */

export type EnquiryDetailsValues = {
  name: string;
  phone: string;
  checkIn: string;
  checkOut: string;
  adults: string;
  children: string;
  childrenAges: string;
  pets: string;
  requests: string;
  ownerNote: string;
  agreedTotalRupees: string;
  agreedAdvanceRupees: string;
  priceNote: string;
};

export const EMPTY_ENQUIRY_DETAILS: EnquiryDetailsValues = {
  name: '',
  phone: '',
  checkIn: '',
  checkOut: '',
  adults: '',
  children: '',
  childrenAges: '',
  pets: '',
  requests: '',
  ownerNote: '',
  agreedTotalRupees: '',
  agreedAdvanceRupees: '',
  priceNote: '',
};

type Source = {
  name: string;
  phone: string;
  checkIn: string | null;
  checkOut: string | null;
  adults: number | null;
  children: number | null;
  pets: number | null;
  requests: string | null;
  childrenAges?: string | null;
  ownerNote?: string | null;
  agreedTotalPaise?: number | null;
  agreedAdvancePaise?: number | null;
  priceNote?: string | null;
};

const n = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const r = (paise: number | null | undefined) => (paise ? String(Math.round(paise / 100)) : '');

export function detailsFrom(row: Source): EnquiryDetailsValues {
  return {
    name: row.name,
    phone: row.phone,
    checkIn: row.checkIn ?? '',
    checkOut: row.checkOut ?? '',
    adults: n(row.adults),
    children: n(row.children),
    childrenAges: row.childrenAges ?? '',
    pets: n(row.pets),
    requests: row.requests ?? '',
    ownerNote: row.ownerNote ?? '',
    agreedTotalRupees: r(row.agreedTotalPaise),
    agreedAdvanceRupees: r(row.agreedAdvancePaise),
    priceNote: row.priceNote ?? '',
  };
}

/** The request body: every field, empty strings clear optional ones. */
export function detailsBody(values: EnquiryDetailsValues) {
  return { ...values, name: values.name.trim(), phone: values.phone.trim() };
}

const INPUT = 'w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary';
const LABEL = 'mb-1 block text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground';

export function EnquiryDetailsForm({
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
  testId,
}: {
  initial: EnquiryDetailsValues;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (values: EnquiryDetailsValues) => void;
  testId: string;
}) {
  const [v, setV] = useState(initial);
  const set = (key: keyof EnquiryDetailsValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [key]: e.target.value });
  const nights =
    v.checkIn && v.checkOut && v.checkOut > v.checkIn ? Math.round((Date.parse(v.checkOut) - Date.parse(v.checkIn)) / 86_400_000) : 0;
  const heads = (Number(v.adults) || 0) + (Number(v.children) || 0);

  return (
    <form
      className="mt-4 rounded-2xl border border-border bg-card p-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
      data-testid={testId}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="sm:col-span-2">
          <span className={LABEL}>Name</span>
          <input required maxLength={200} value={v.name} onChange={set('name')} className={INPUT} />
        </label>
        <label className="sm:col-span-2">
          <span className={LABEL}>Phone</span>
          <input required type="tel" inputMode="tel" placeholder="+91 98765 43210" maxLength={20} value={v.phone} onChange={set('phone')} className={INPUT} />
        </label>
        <label>
          <span className={LABEL}>Check-in</span>
          <input type="date" value={v.checkIn} onChange={set('checkIn')} className={INPUT} />
        </label>
        <label>
          <span className={LABEL}>Check-out (day they leave)</span>
          <input type="date" value={v.checkOut} onChange={set('checkOut')} className={INPUT} />
        </label>
        <label>
          <span className={LABEL}>Adults</span>
          <input type="number" min={0} max={50} value={v.adults} onChange={set('adults')} className={INPUT} />
        </label>
        <label>
          <span className={LABEL}>Children</span>
          <input type="number" min={0} max={50} value={v.children} onChange={set('children')} className={INPUT} />
        </label>
        <label>
          <span className={LABEL}>Children's ages</span>
          <input maxLength={100} placeholder="e.g. 6 and 9" value={v.childrenAges} onChange={set('childrenAges')} className={INPUT} />
        </label>
        <label>
          <span className={LABEL}>Pets</span>
          <input type="number" min={0} max={10} value={v.pets} onChange={set('pets')} className={INPUT} />
        </label>
        <label className="sm:col-span-2">
          <span className={LABEL}>What they asked for</span>
          <input maxLength={1000} value={v.requests} onChange={set('requests')} className={INPUT} />
        </label>
        <label className="sm:col-span-4">
          <span className={LABEL}>Private note (never sent to the guest)</span>
          <textarea maxLength={1000} rows={2} value={v.ownerNote} onChange={set('ownerNote')} className={INPUT} />
        </label>
        <label>
          <span className={LABEL}>Agreed total for the stay (₹)</span>
          <input inputMode="numeric" placeholder="Leave empty for the rate card" value={v.agreedTotalRupees} onChange={set('agreedTotalRupees')} className={INPUT} />
        </label>
        <label>
          <span className={LABEL}>Advance to confirm (₹)</span>
          <input inputMode="numeric" placeholder="Usual share" value={v.agreedAdvanceRupees} onChange={set('agreedAdvanceRupees')} className={INPUT} />
        </label>
        <label className="sm:col-span-2">
          <span className={LABEL}>How the price is made up (shown to the guest)</span>
          <input maxLength={300} placeholder="₹3,500 a night for 5 + ₹750 per extra guest" value={v.priceNote} onChange={set('priceNote')} className={INPUT} />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || !v.name.trim() || !v.phone.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-[10px] font-bold uppercase tracking-[.07em] text-primary-foreground disabled:opacity-40"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {submitLabel}
        </button>
        <span className="text-xs text-muted-foreground">
          {nights ? `${nights} night${nights === 1 ? '' : 's'}` : 'Dates optional'}
          {heads ? ` · ${heads} guest${heads === 1 ? '' : 's'}` : ''}
          {v.agreedTotalRupees ? ' · the agreed price replaces the rate card' : ''}
        </span>
      </div>
      {error && (
        <p className="mt-2 text-xs text-[#A65E45]" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
