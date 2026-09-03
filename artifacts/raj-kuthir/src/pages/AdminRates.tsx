import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
  ArrowUpRight,
  CalendarRange,
  IndianRupee,
  Loader2,
  LogOut,
  Plus,
  Trash2,
} from 'lucide-react';
import { adminFetch, useAdminSession, useLogout } from '@/lib/admin-api';
import {
  formatRupees,
  useRatePlan,
  RATES_KEY,
  type RateMode,
} from '@/lib/rates';

const GUEST_COUNTS = [1, 2, 3, 4, 5];

const MODE_OPTIONS: Array<{
  value: RateMode;
  title: string;
  blurb: string;
}> = [
  {
    value: 'percent',
    title: 'Percentage',
    blurb: 'Raise every standard rate by a set %. One number to maintain.',
  },
  {
    value: 'demand',
    title: 'Demand range',
    blurb: 'Climbs from a floor % to a ceiling % as enquiries come in.',
  },
  {
    value: 'fixed',
    title: 'Exact prices',
    blurb: 'Type the rupee price for each occupancy yourself.',
  },
];

const emptyPeak = () => ({
  startDate: '',
  endDate: '',
  label: '',
  mode: 'percent' as RateMode,
  percent: '',
  minPercent: '',
  maxPercent: '',
  demandThreshold: '',
  amounts: Object.fromEntries(GUEST_COUNTS.map((n) => [String(n), ''])) as Record<
    string,
    string
  >,
});

export default function AdminRates() {
  const [, navigate] = useLocation();
  const session = useAdminSession();
  const logout = useLogout();
  const queryClient = useQueryClient();
  const signedIn = session.data?.signedIn === true;

  useEffect(() => {
    if (session.isSuccess && !signedIn) {
      navigate('/admin/login', { replace: true });
    }
  }, [session.isSuccess, signedIn, navigate]);

  const plan = useRatePlan();

  const [standing, setStanding] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [peak, setPeak] = useState(emptyPeak);
  const [peakOpen, setPeakOpen] = useState(false);

  // Seed the form from the server, but never overwrite what is being typed.
  useEffect(() => {
    if (!plan.data || touched) return;

    setStanding(
      Object.fromEntries(
        GUEST_COUNTS.map((n) => [
          String(n),
          plan.data.rates[String(n)]
            ? String(plan.data.rates[String(n)] / 100)
            : '',
        ]),
      ),
    );
  }, [plan.data, touched]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: RATES_KEY });
  };

  const saveStanding = useMutation({
    mutationFn: () =>
      adminFetch('/api/rates', {
        method: 'PUT',
        body: JSON.stringify({
          rates: Object.fromEntries(
            Object.entries(standing).filter(([, value]) => value !== ''),
          ),
        }),
      }),
    onSuccess: () => {
      setTouched(false);
      invalidate();
    },
  });

  const addPeak = useMutation({
    mutationFn: () =>
      adminFetch('/api/rates/overrides', {
        method: 'POST',
        body: JSON.stringify({
          startDate: peak.startDate,
          endDate: peak.endDate,
          label: peak.label || null,
          mode: peak.mode,
          ...(peak.mode === 'percent' ? { percent: peak.percent } : {}),
          ...(peak.mode === 'demand'
            ? {
                minPercent: peak.minPercent,
                maxPercent: peak.maxPercent,
                demandThreshold: Number(peak.demandThreshold),
              }
            : {}),
          ...(peak.mode === 'fixed'
            ? {
                amounts: Object.fromEntries(
                  Object.entries(peak.amounts).filter(
                    ([, value]) => value !== '',
                  ),
                ),
              }
            : {}),
        }),
      }),
    onSuccess: () => {
      setPeak(emptyPeak());
      setPeakOpen(false);
      invalidate();
    },
  });

  const removePeak = useMutation({
    mutationFn: (id: string) =>
      adminFetch(`/api/rates/overrides/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  if (session.isLoading || (session.isSuccess && !signedIn)) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const standingError =
    saveStanding.error instanceof Error ? saveStanding.error.message : null;
  const peakError = addPeak.error instanceof Error ? addPeak.error.message : null;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 px-5 py-5 md:px-8">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.14em] text-accent">
              Pricing
            </p>
            <h1 className="mt-1 font-journal text-2xl text-primary md:text-3xl">
              Nightly rates
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="/admin"
              className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-[.09em] text-primary transition-colors hover:border-primary"
            >
              Calendar <ArrowUpRight size={13} />
            </a>
            <button
              type="button"
              onClick={() =>
                logout.mutate(undefined, {
                  onSuccess: () => navigate('/admin/login', { replace: true }),
                })
              }
              className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[11px] font-bold uppercase tracking-[.09em] text-primary-foreground transition-transform hover:-translate-y-0.5"
            >
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-5 py-8 md:px-8 md:py-10">
        <section aria-label="Standing rates">
          <Heading
            icon={<IndianRupee size={15} />}
            title="Standard rates"
            description="Price per night for the whole villa, by how many guests are staying. These apply on every date that isn't covered by a peak period below."
          />

          <div className="mt-4 rounded-2xl border border-border bg-card p-5 md:p-6">
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {GUEST_COUNTS.map((guests) => (
                <label key={guests} className="block">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">
                    {guests} {guests === 1 ? 'guest' : 'guests'}
                  </span>
                  <div className="flex items-center rounded-lg border border-border bg-background focus-within:border-primary">
                    <span className="pl-3 text-sm text-muted-foreground">₹</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={standing[String(guests)] ?? ''}
                      onChange={(event) => {
                        setTouched(true);
                        setStanding((current) => ({
                          ...current,
                          [String(guests)]: event.target.value,
                        }));
                      }}
                      className="w-full bg-transparent px-2 py-2.5 text-sm tabular-nums outline-none"
                      data-testid={`input-rate-${guests}`}
                    />
                  </div>
                </label>
              ))}
            </div>

            {standingError && (
              <p className="mt-3 text-xs text-[#A65E45]" role="alert">
                {standingError}
              </p>
            )}

            <button
              type="button"
              onClick={() => saveStanding.mutate()}
              disabled={!touched || saveStanding.isPending}
              className="mt-5 flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-[11px] font-bold uppercase tracking-[.09em] text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="button-save-rates"
            >
              {saveStanding.isPending && (
                <Loader2 size={14} className="animate-spin" />
              )}
              Save rates
            </button>
          </div>
        </section>

        <section className="mt-8 pb-6" aria-label="Peak periods">
          <Heading
            icon={<CalendarRange size={15} />}
            title="Peak periods"
            description="Festival weeks, New Year, Poush Mela — a date range with its own prices. Leave an occupancy blank to keep the standard rate for it."
            action={
              <button
                type="button"
                onClick={() => setPeakOpen((value) => !value)}
                className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[11px] font-bold uppercase tracking-[.09em] text-primary-foreground transition-transform hover:-translate-y-0.5"
                data-testid="button-add-peak"
              >
                <Plus size={14} /> {peakOpen ? 'Close' : 'Add peak period'}
              </button>
            }
          />

          {peakOpen && (
            <div className="mt-4 rounded-2xl border border-border bg-card p-5 md:p-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="From (first night)">
                  <input
                    type="date"
                    value={peak.startDate}
                    onChange={(event) =>
                      setPeak({ ...peak, startDate: event.target.value })
                    }
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
                    data-testid="input-peak-start"
                  />
                </Field>
                <Field label="To (morning of departure)">
                  <input
                    type="date"
                    value={peak.endDate}
                    onChange={(event) =>
                      setPeak({ ...peak, endDate: event.target.value })
                    }
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
                    data-testid="input-peak-end"
                  />
                </Field>
                <Field label="Name">
                  <input
                    value={peak.label}
                    placeholder="Poush Mela"
                    onChange={(event) =>
                      setPeak({ ...peak, label: event.target.value })
                    }
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
                    data-testid="input-peak-label"
                  />
                </Field>
              </div>

              <div className="mt-6">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">
                  How should this period be priced?
                </p>
                <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Pricing mode">
                  {MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={peak.mode === option.value}
                      onClick={() => setPeak({ ...peak, mode: option.value })}
                      className={`rounded-xl border p-4 text-left transition-colors ${peak.mode === option.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
                      data-testid={`button-peak-mode-${option.value}`}
                    >
                      <span className="flex items-center gap-2 text-sm font-bold text-primary">
                        <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${peak.mode === option.value ? 'border-primary' : 'border-border'}`}>
                          {peak.mode === option.value && (
                            <span className="h-2 w-2 rounded-full bg-primary" />
                          )}
                        </span>
                        {option.title}
                      </span>
                      <span className="mt-2 block text-[11px] leading-4 text-muted-foreground">
                        {option.blurb}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {peak.mode === 'percent' && (
                <div className="mt-5 max-w-[280px]">
                  <Field label="Increase over standard rates">
                    <div className="flex items-center rounded-lg border border-border bg-background focus-within:border-primary">
                      <input
                        type="number"
                        inputMode="numeric"
                        placeholder="30"
                        value={peak.percent}
                        onChange={(event) =>
                          setPeak({ ...peak, percent: event.target.value })
                        }
                        className="w-full bg-transparent px-3 py-2.5 text-sm tabular-nums outline-none"
                        data-testid="input-peak-percent"
                      />
                      <span className="pr-3 text-sm text-muted-foreground">%</span>
                    </div>
                  </Field>
                  <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                    A negative number discounts instead — useful for a quiet season.
                  </p>
                </div>
              )}

              {peak.mode === 'demand' && (
                <>
                  <div className="mt-5 grid gap-4 sm:grid-cols-3">
                    <Field label="Starting increase">
                      <div className="flex items-center rounded-lg border border-border bg-background focus-within:border-primary">
                        <input
                          type="number"
                          inputMode="numeric"
                          placeholder="10"
                          value={peak.minPercent}
                          onChange={(event) =>
                            setPeak({ ...peak, minPercent: event.target.value })
                          }
                          className="w-full bg-transparent px-3 py-2.5 text-sm tabular-nums outline-none"
                          data-testid="input-peak-min-percent"
                        />
                        <span className="pr-3 text-sm text-muted-foreground">%</span>
                      </div>
                    </Field>
                    <Field label="Maximum increase">
                      <div className="flex items-center rounded-lg border border-border bg-background focus-within:border-primary">
                        <input
                          type="number"
                          inputMode="numeric"
                          placeholder="50"
                          value={peak.maxPercent}
                          onChange={(event) =>
                            setPeak({ ...peak, maxPercent: event.target.value })
                          }
                          className="w-full bg-transparent px-3 py-2.5 text-sm tabular-nums outline-none"
                          data-testid="input-peak-max-percent"
                        />
                        <span className="pr-3 text-sm text-muted-foreground">%</span>
                      </div>
                    </Field>
                    <Field label="Enquiries to reach maximum">
                      <input
                        type="number"
                        inputMode="numeric"
                        placeholder="10"
                        value={peak.demandThreshold}
                        onChange={(event) =>
                          setPeak({ ...peak, demandThreshold: event.target.value })
                        }
                        className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm tabular-nums outline-none focus:border-primary"
                        data-testid="input-peak-threshold"
                      />
                    </Field>
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                    The price starts at the lower figure and rises towards the higher one
                    as enquiries for these dates arrive, reaching the maximum at the
                    number you set. It never goes above it.
                  </p>
                </>
              )}

              {peak.mode === 'fixed' && (
                <div className="mt-5 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  {GUEST_COUNTS.map((guests) => (
                    <Field
                      key={guests}
                      label={`${guests} ${guests === 1 ? 'guest' : 'guests'}`}
                    >
                      <div className="flex items-center rounded-lg border border-border bg-background focus-within:border-primary">
                        <span className="pl-3 text-sm text-muted-foreground">
                          ₹
                        </span>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={peak.amounts[String(guests)] ?? ''}
                          onChange={(event) =>
                            setPeak({
                              ...peak,
                              amounts: {
                                ...peak.amounts,
                                [String(guests)]: event.target.value,
                              },
                            })
                          }
                          className="w-full bg-transparent px-2 py-2.5 text-sm tabular-nums outline-none"
                          data-testid={`input-peak-rate-${guests}`}
                        />
                      </div>
                    </Field>
                  ))}
                </div>
              )}

              {peakError && (
                <p className="mt-3 text-xs text-[#A65E45]" role="alert">
                  {peakError}
                </p>
              )}

              <button
                type="button"
                onClick={() => addPeak.mutate()}
                disabled={!peak.startDate || !peak.endDate || addPeak.isPending}
                className="mt-5 flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-[11px] font-bold uppercase tracking-[.09em] text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                data-testid="button-save-peak"
              >
                {addPeak.isPending && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                Save peak period
              </button>
            </div>
          )}

          <div className="mt-4 space-y-3">
            {plan.isLoading && (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}

            {!plan.isLoading && (plan.data?.overrides.length ?? 0) === 0 && (
              <div className="rounded-2xl border border-border bg-card p-5">
                <p className="text-sm text-muted-foreground">
                  No peak periods yet. Standard rates apply on every date.
                </p>
              </div>
            )}

            {(plan.data?.overrides ?? []).map((override) => (
              <div
                key={override.id}
                className="rounded-2xl border border-border bg-card p-5"
                data-testid={`row-peak-${override.id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="font-journal text-xl text-primary">
                      {override.label || 'Peak period'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {format(parseISO(override.startDate), 'd MMM yyyy')} →{' '}
                      {format(parseISO(override.endDate), 'd MMM yyyy')}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.07em] text-muted-foreground">
                        {override.mode === 'percent'
                          ? `+${override.percent}% over standard`
                          : override.mode === 'demand'
                            ? `Demand ${override.minPercent}–${override.maxPercent}%`
                            : 'Exact prices'}
                      </span>

                      {override.mode === 'demand' && (
                        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.07em] text-primary">
                          {override.enquiryCount ?? 0}{' '}
                          {override.enquiryCount === 1 ? 'enquiry' : 'enquiries'}
                          {' · now +'}
                          {override.effectivePercent ?? override.minPercent}%
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removePeak.mutate(override.id)}
                    disabled={removePeak.isPending}
                    className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-semibold text-[#A65E45] transition-colors hover:bg-[#A65E45]/5 disabled:opacity-50"
                    data-testid={`button-delete-peak-${override.id}`}
                  >
                    <Trash2 size={13} /> Remove
                  </button>
                </div>

                <p className="mt-4 border-t border-border pt-4 text-[10px] font-bold uppercase tracking-[.07em] text-muted-foreground">
                  Charging now
                </p>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                  {GUEST_COUNTS.map((guests) => {
                    const amount = override.amounts[String(guests)];
                    return (
                      <span key={guests} className="text-xs">
                        <span className="text-muted-foreground">
                          {guests}
                          {guests === 1 ? ' guest' : ' guests'}:{' '}
                        </span>
                        {typeof amount === 'number' ? (
                          <span className="font-bold tabular-nums text-primary">
                            {formatRupees(amount)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/70">
                            standard
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function Heading({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-accent">
          {icon}
          {title}
        </p>
        <p className="mt-2 max-w-[560px] text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
