import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, subDays } from 'date-fns';
import { CalendarRange, IndianRupee, Loader2, Pencil, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import { adminFetch } from '@/lib/admin-api';
import { formatRupees, RATES_KEY, type PeakPeriod, type RatePlan } from '@/lib/rates';

/*
 * The owner's two pricing controls:
 *
 *   - the rate ladder: weekday / weekend base for up to two guests, the charge
 *     per guest beyond, the floor no night may go under, and the weekly discount
 *   - peak periods: date ranges priced a set % under the Booking.com rate for
 *     those dates, with a minimum stay
 *
 * All rules live on the server (api-server/src/lib/pricing.ts); this screen
 * edits the numbers and shows what they produce.
 */

const rupees = (paise: number | null | undefined) =>
  paise === null || paise === undefined ? '' : String(Math.round(paise / 100));

/** Peak periods are stored with an exclusive end; the owner thinks in nights. */
const lastNightOf = (endDate: string) => format(subDays(parseISO(endDate), 1), 'yyyy-MM-dd');
const prettyNight = (iso: string) => format(parseISO(iso), 'EEE d MMM yyyy');

function useInvalidateRates() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: RATES_KEY });
}

export function RateLadderSection({ plan }: { plan: RatePlan | undefined }) {
  const invalidate = useInvalidateRates();
  const ladder = plan?.ladder;
  const [form, setForm] = useState({
    weekdayBase: '',
    weekendBase: '',
    extraGuest: '',
    floor: '',
    weeklyDiscountPercent: '',
  });
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!ladder || touched) return;
    setForm({
      weekdayBase: rupees(ladder.weekdayBasePaise),
      weekendBase: rupees(ladder.weekendBasePaise),
      extraGuest: rupees(ladder.extraGuestPaise),
      floor: rupees(ladder.floorPaise),
      weeklyDiscountPercent: String(ladder.weeklyDiscountPercent),
    });
  }, [ladder, touched]);

  const save = useMutation({
    mutationFn: () => adminFetch('/api/rates/ladder', { method: 'PUT', body: JSON.stringify(form) }),
    onSuccess: () => {
      setTouched(false);
      invalidate();
    },
  });

  const set = (key: keyof typeof form) => (value: string) => {
    setTouched(true);
    setForm((current) => ({ ...current, [key]: value }));
  };

  // Preview from what is typed, so the owner sees the result before saving.
  const n = (value: string) => Math.max(0, Math.round(Number(value) || 0));
  const floor = n(form.floor);
  const included = ladder?.includedGuests ?? 2;
  const preview = [1, 2, 3, 4, 5].map((guests) => {
    const extra = Math.max(0, guests - included) * n(form.extraGuest);
    return {
      guests,
      weekday: Math.max(floor, n(form.weekdayBase) + extra),
      weekend: Math.max(floor, n(form.weekendBase) + extra),
    };
  });
  const error = save.error instanceof Error ? save.error.message : null;

  return (
    <section aria-label="Rate ladder">
      <Heading
        icon={<IndianRupee size={15} />}
        title="Rate ladder"
        description={`Price per night for the whole villa. The base covers up to ${included} guests; each guest after that adds the extra charge. No night — peak, discount or older rule — is ever priced below the floor.`}
      />
      <div className="mt-4 rounded-2xl border border-border bg-card p-5 md:p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Money label={`Sun–Thu, 1–${included} guests`} value={form.weekdayBase} onChange={set('weekdayBase')} testId="input-ladder-weekday" />
          <Money label={`Fri–Sat, 1–${included} guests`} value={form.weekendBase} onChange={set('weekendBase')} testId="input-ladder-weekend" />
          <Money label="Each extra guest / night" value={form.extraGuest} onChange={set('extraGuest')} testId="input-ladder-extra" />
          <Money label="Floor — lowest night" value={form.floor} onChange={set('floor')} testId="input-ladder-floor" />
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">
              Weekly discount ({ladder?.weeklyMinNights ?? 7}+ nights)
            </span>
            <div className="flex items-center rounded-lg border border-border bg-background focus-within:border-primary">
              <input
                id="input-ladder-weekly"
                type="number"
                min={0}
                max={10}
                inputMode="numeric"
                value={form.weeklyDiscountPercent}
                onChange={(event) => set('weeklyDiscountPercent')(event.target.value)}
                className="w-full bg-transparent px-3 py-2.5 text-sm tabular-nums outline-none"
                data-testid="input-ladder-weekly"
              />
              <span className="pr-3 text-sm text-muted-foreground">% (max 10)</span>
            </div>
          </label>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm tabular-nums">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-[.08em] text-muted-foreground">
                <th className="py-2 font-bold">Guests</th>
                {preview.map((row) => (
                  <th key={row.guests} className="py-2 text-right font-bold">{row.guests}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <th className="py-2 text-xs font-bold text-primary">Sun–Thu</th>
                {preview.map((row) => (
                  <td key={row.guests} className="py-2 text-right">₹{row.weekday.toLocaleString('en-IN')}</td>
                ))}
              </tr>
              <tr>
                <th className="py-2 text-xs font-bold text-primary">Fri–Sat</th>
                {preview.map((row) => (
                  <td key={row.guests} className="py-2 text-right">₹{row.weekend.toLocaleString('en-IN')}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {error && <p className="mt-3 text-xs text-[#A65E45]" role="alert">{error}</p>}
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={!touched || save.isPending}
          className="mt-5 flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-[11px] font-bold uppercase tracking-[.09em] text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="button-save-ladder"
        >
          {save.isPending && <Loader2 size={14} className="animate-spin" />}
          Save ladder
        </button>
      </div>
    </section>
  );
}

const emptyPeak = () => ({
  label: '',
  firstNight: '',
  lastNight: '',
  bookingComRate: '',
  discountPercent: '10',
  minNights: '2',
});

export function PeakPeriodsSection({ plan }: { plan: RatePlan | undefined }) {
  const invalidate = useInvalidateRates();
  const [form, setForm] = useState(emptyPeak);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const peaks = plan?.peaks ?? [];
  const extra = plan?.ladder?.extraGuestPaise ?? 0;
  const floor = plan?.ladder?.floorPaise ?? 0;

  const save = useMutation({
    mutationFn: () =>
      adminFetch(editingId ? `/api/rates/peaks/${editingId}` : '/api/rates/peaks', {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      setForm(emptyPeak());
      setOpen(false);
      setEditingId(null);
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminFetch(`/api/rates/peaks/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const edit = (peak: PeakPeriod) => {
    setEditingId(peak.id);
    setOpen(true);
    setForm({
      label: peak.label,
      firstNight: peak.startDate,
      lastNight: lastNightOf(peak.endDate),
      bookingComRate: rupees(peak.bookingComPaise),
      discountPercent: String(peak.discountPercent),
      minNights: String(peak.minNights),
    });
  };

  const close = () => {
    setEditingId(null);
    setForm(emptyPeak());
    setOpen(false);
  };

  const set = (key: keyof ReturnType<typeof emptyPeak>) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const priceFor = (bookingComPaise: number, discount: number, guests: number) =>
    Math.max(
      floor,
      Math.round((bookingComPaise * (1 - discount / 100)) / 100) * 100 +
        Math.max(0, guests - (plan?.ladder?.includedGuests ?? 2)) * extra,
    );

  const typedRate = Math.round(Number(form.bookingComRate) || 0) * 100;
  const error = save.error instanceof Error ? save.error.message : null;

  return (
    <section className="mt-8" aria-label="Peak periods">
      <Heading
        icon={<CalendarRange size={15} />}
        title="Peak periods"
        description="Festival dates priced a set % below what Booking.com charges for the same nights, with a minimum stay. Enter the Booking.com rate for 1–2 guests; extra guests are added on top. The floor still applies."
        action={
          open ? (
            <button type="button" onClick={close} className="flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-[11px] font-bold uppercase tracking-[.09em] text-primary transition-colors hover:border-primary">
              <X size={14} /> Cancel
            </button>
          ) : (
            <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[11px] font-bold uppercase tracking-[.09em] text-primary-foreground" data-testid="button-add-peak-period">
              <Plus size={14} /> Add period
            </button>
          )
        }
      />

      {open && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-5 md:p-6" data-testid="form-peak-period">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <TextField id="peak-label" label="Name" value={form.label} onChange={set('label')} placeholder="Poush Mela, Christmas & New Year" />
            <TextField id="peak-first" label="First night" type="date" value={form.firstNight} onChange={set('firstNight')} />
            <TextField id="peak-last" label="Last night" type="date" value={form.lastNight} onChange={set('lastNight')} />
            <Money label="Booking.com rate / night (1–2 guests)" value={form.bookingComRate} onChange={set('bookingComRate')} testId="input-peak-bookingcom" />
            <TextField id="peak-discount" label="% below Booking.com" type="number" value={form.discountPercent} onChange={set('discountPercent')} />
            <TextField id="peak-min" label="Minimum nights" type="number" value={form.minNights} onChange={set('minNights')} />
          </div>
          {typedRate > 0 && (
            <p className="mt-4 text-sm text-primary">
              Guests pay {formatRupees(priceFor(typedRate, Number(form.discountPercent) || 0, 2))} a night for 1–2,{' '}
              {formatRupees(priceFor(typedRate, Number(form.discountPercent) || 0, 5))} for 5.
            </p>
          )}
          {error && <p className="mt-3 text-xs text-[#A65E45]" role="alert">{error}</p>}
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="mt-5 flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-[11px] font-bold uppercase tracking-[.09em] text-primary-foreground disabled:opacity-40"
            data-testid="button-save-peak-period"
          >
            {save.isPending && <Loader2 size={14} className="animate-spin" />}
            {editingId ? 'Save changes' : 'Add period'}
          </button>
        </div>
      )}

      <ul className="mt-4 flex flex-col gap-3">
        {peaks.map((peak) => (
          <li key={peak.id} className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border bg-card p-5" data-testid={`row-peak-${peak.id}`}>
            <div className="min-w-0">
              <p className="font-journal text-xl text-primary">{peak.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {prettyNight(peak.startDate)} → {prettyNight(lastNightOf(peak.endDate))} (last night) · {peak.minNights}-night minimum
              </p>
              {peak.bookingComPaise === null ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-[#A65E45]">
                  <TriangleAlert size={13} /> Booking.com rate not entered — these nights use the normal weekday/weekend rate until it is.
                </p>
              ) : (
                <p className="mt-2 text-sm text-primary">
                  Booking.com {formatRupees(peak.bookingComPaise)} → guests pay{' '}
                  <strong>{formatRupees(priceFor(peak.bookingComPaise, peak.discountPercent, 2))}</strong> for 1–2 ({peak.discountPercent}% less)
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => edit(peak)} className="grid h-9 w-9 place-items-center rounded-full border border-border text-primary hover:border-primary" aria-label={`Edit ${peak.label}`}>
                <Pencil size={13} />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Remove "${peak.label}"? Those nights go back to the normal rate.`)) remove.mutate(peak.id);
                }}
                className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground hover:border-[#A65E45] hover:text-[#A65E45]"
                aria-label={`Remove ${peak.label}`}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </li>
        ))}
        {peaks.length === 0 && <li className="text-sm text-muted-foreground">No peak periods.</li>}
      </ul>
    </section>
  );
}

function Heading({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-[640px]">
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.1em] text-accent">
          {icon} {title}
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function Money({ label, value, onChange, testId }: { label: string; value: string; onChange: (value: string) => void; testId: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">{label}</span>
      <div className="flex items-center rounded-lg border border-border bg-background focus-within:border-primary">
        <span className="pl-3 text-sm text-muted-foreground">₹</span>
        <input
          id={testId}
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full bg-transparent px-2 py-2.5 text-sm tabular-nums outline-none"
          data-testid={testId}
        />
      </div>
    </label>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
      />
    </label>
  );
}
