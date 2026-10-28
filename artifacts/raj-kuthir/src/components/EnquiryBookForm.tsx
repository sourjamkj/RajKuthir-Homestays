import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CalendarPlus, Loader2, X } from 'lucide-react';

import { adminFetch } from '@/lib/admin-api';

/**
 * "Book with my details" on an enquiry: the owner fills in what the enquiry
 * lacks — dates, party, the price they agreed, the advance received — and it
 * becomes a booking in one step. Same conversion and duplicate rules as
 * Create booking on the server; the price is the owner's own deal.
 */

type Row = {
  id: string;
  checkIn: string | null;
  checkOut: string | null;
  adults: number | null;
  children: number | null;
  pets: number | null;
  quotedTotalPaise: number | null;
  quotedAdvancePaise: number | null;
  quote: { ok: boolean; totalPaise?: number; advancePaise?: number };
};

const INPUT = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-primary outline-none focus:border-primary';
const LABEL = 'block text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground';

const rupees = (paise: number | null | undefined) => (paise ? String(Math.round(paise / 100)) : '');

export function EnquiryBookForm({ row, onBooked }: { row: Row; onBooked: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => ({
    checkIn: row.checkIn ?? '',
    checkOut: row.checkOut ?? '',
    adults: String(row.adults ?? 2),
    children: String(row.children ?? 0),
    pets: String(row.pets ?? 0),
    total: rupees(row.quotedTotalPaise ?? (row.quote.ok ? row.quote.totalPaise : null)),
    advance: rupees(row.quotedAdvancePaise),
    noAdvance: false,
  }));
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value });

  const book = useMutation({
    mutationFn: () =>
      adminFetch<{ booking: { reference: string | null } }>(`/api/enquiries/${row.id}/book`, {
        method: 'POST',
        body: JSON.stringify({
          checkIn: form.checkIn,
          checkOut: form.checkOut,
          adults: Number(form.adults),
          children: Number(form.children || 0),
          pets: Number(form.pets || 0),
          totalRupees: Number(form.total),
          advanceRupees: Number(form.advance || 0),
          confirmWithoutAdvance: form.noAdvance,
        }),
      }),
    onSuccess: () => {
      setOpen(false);
      onBooked();
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-primary px-3 py-2 text-[10px] font-bold uppercase tracking-[.07em] text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
        data-testid={`button-book-details-${row.id}`}
      >
        <CalendarPlus size={12} /> Book with my details
      </button>
    );
  }

  const nights =
    form.checkIn && form.checkOut && form.checkOut > form.checkIn
      ? Math.round((Date.parse(form.checkOut) - Date.parse(form.checkIn)) / 86_400_000)
      : 0;

  return (
    <form
      className="mt-3 rounded-xl border border-primary/30 bg-background/60 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        book.mutate();
      }}
      data-testid={`form-book-details-${row.id}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[.08em] text-primary">Book with my details</p>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close"><X size={14} /></button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className={LABEL}>Check-in<input id={`bk-in-${row.id}`} type="date" required value={form.checkIn} onChange={set('checkIn')} className={`${INPUT} mt-1`} /></label>
        <label className={LABEL}>Check-out<input id={`bk-out-${row.id}`} type="date" required value={form.checkOut} onChange={set('checkOut')} className={`${INPUT} mt-1`} /></label>
        <label className={LABEL}>Adults<input id={`bk-adults-${row.id}`} type="number" min={1} max={20} required value={form.adults} onChange={set('adults')} className={`${INPUT} mt-1`} /></label>
        <label className={LABEL}>Children<input id={`bk-children-${row.id}`} type="number" min={0} max={20} value={form.children} onChange={set('children')} className={`${INPUT} mt-1`} /></label>
        <label className={LABEL}>Pets<input id={`bk-pets-${row.id}`} type="number" min={0} max={10} value={form.pets} onChange={set('pets')} className={`${INPUT} mt-1`} /></label>
        <label className={LABEL}>Total for the stay (₹)<input id={`bk-total-${row.id}`} type="number" min={1} required value={form.total} onChange={set('total')} className={`${INPUT} mt-1`} /></label>
        <label className={LABEL}>Advance received (₹)<input id={`bk-adv-${row.id}`} type="number" min={0} value={form.advance} onChange={set('advance')} className={`${INPUT} mt-1`} /></label>
        <div className="flex items-end text-[12px] text-muted-foreground">
          {nights ? `${nights} night${nights === 1 ? '' : 's'}` : 'Check-out is the day they leave'}
        </div>
      </div>
      {!Number(form.advance || 0) && (
        <label className="mt-3 flex items-center gap-2 text-[12px] text-primary">
          <input id={`bk-noadv-${row.id}`} type="checkbox" checked={form.noAdvance} onChange={set('noAdvance')} />
          Confirm without an advance (it will hold the dates)
        </label>
      )}
      {book.isError && (
        <p className="mt-2 text-xs text-[#A65E45]" role="alert">{book.error instanceof Error ? book.error.message : 'Could not book.'}</p>
      )}
      <button
        type="submit"
        disabled={book.isPending}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-[11px] font-bold uppercase tracking-[.07em] text-primary-foreground disabled:opacity-40"
      >
        {book.isPending ? <Loader2 size={12} className="animate-spin" /> : <CalendarPlus size={12} />} Create booking
      </button>
    </form>
  );
}
