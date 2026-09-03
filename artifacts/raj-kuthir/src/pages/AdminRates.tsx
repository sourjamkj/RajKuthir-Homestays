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
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { adminFetch, useAdminSession, useLogout } from '@/lib/admin-api';
import {
  formatRupees,
  useRatePlan,
  RATES_KEY,
  type RateMode,
  type RateOverride,
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

  const plan = useRatePlan({ fresh: true });

  const [standing, setStanding] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [peak, setPeak] = useState(emptyPeak);
  const [peakOpen, setPeakOpen] = useState(false);
  /** Set when the form is editing an existing period rather than creating one. */
  const [editingId, setEditingId] = useState<string | null>(null);

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
    // Matches both the public key and the admin's ['...','fresh'] variant.
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
      adminFetch(
        editingId
          ? `/api/rates/overrides/${editingId}`
          : '/api/rates/overrides',
        {
        method: editingId ? 'PATCH' : 'POST',
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
        },
      ),
    onSuccess: () => {
      setPeak(emptyPeak());
      setPeakOpen(false);
      setEditingId(null);
      invalidate();
    },
  });

  const startEdit = (override: RateOverride) => {
    setEditingId(override.id);
    setPeakOpen(true);
    setPeak({
      startDate: override.startDate,
      endDate: override.endDate,
      label: override.label ?? '',
      mode: override.mode,
      percent: override.percent !== null ? String(override.percent) : '',
      minPercent:
        override.minPercent !== null ? String(override.minPercent) : '',
      maxPercent:
        override.maxPercent !== null ? String(override.maxPercent) : '',
      demandThreshold:
        override.demandThreshold !== null
          ? String(override.demandThreshold)
          : '',
      amounts: Object.fromEntries(
        GUEST_COUNTS.map((n) => [
          String(n),
          override.mode === 'fixed' && override.amounts[String(n)]
            ? String(override.amounts[String(n)]! / 100)
            : '',
        ]),
      ),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setPeak(emptyPeak());
    setPeakOpen(false);
  };

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

  // Warn about a clash before the period is created, not after.
  const draftClashes =
    peak.startDate && peak.endDate && peak.endDate > peak.startDate
      ? (plan.data?.overrides ?? []).filter(
          (existing) =>
            // A period being edited is not in conflict with itself.
            existing.id !== editingId &&
            peak.startDate < existing.endDate &&
            existing.startDate < peak.endDate,
        )
      : [];

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
              editingId ? (
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-[11px] font-bold uppercase tracking-[.09em] text-primary transition-colors hover:border-primary"
                  data-testid="button-cancel-edit"
                >
                  <X size={14} /> Cancel edit
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setPeakOpen((value) => !value)}
                  className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[11px] font-bold uppercase tracking-[.09em] text-primary-foreground transition-transform hover:-translate-y-0.5"
                  data-testid="button-add-peak"
                >
                  <Plus size={14} /> {peakOpen ? 'Close' : 'Add peak period'}
                </button>
              )
            }
          />

          {peakOpen && (
            <div className={`mt-4 rounded-2xl border bg-card p-5 md:p-6 ${editingId ? 'border-primary' : 'border-border'}`}>
              {editingId && (
                <p
                  className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-[.08em] text-primary"
                  data-testid="text-editing-peak"
                >
                  <Pencil size={13} /> Editing “{peak.label || 'peak period'}”
                </p>
              )}

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

              {draftClashes.length > 0 && (
                <div
                  className="mt-5 flex items-start gap-3 rounded-xl border border-[#d8a24a]/40 bg-[#d8a24a]/10 p-4"
                  role="status"
                  data-testid="warning-draft-overlap"
                >
                  <TriangleAlert
                    size={15}
                    className="mt-0.5 shrink-0 text-[#8a6320]"
                  />
                  <p className="text-xs leading-5 text-[#6b4d18]">
                    These dates overlap{' '}
                    <strong>
                      {draftClashes
                        .map((clash) => clash.label || 'an existing period')
                        .join(', ')}
                    </strong>
                    . You can still save — this new period would take priority
                    on the shared nights — but if that isn't deliberate, adjust
                    the dates first.
                  </p>
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
                {editingId ? 'Save changes' : 'Save peak period'}
              </button>
            </div>
          )}

          <PeakTable
            overrides={plan.data?.overrides ?? []}
            isLoading={plan.isLoading}
            onEdit={startEdit}
            onRemove={(id) => removePeak.mutate(id)}
            removing={removePeak.isPending}
            editingId={editingId}
          />
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

/**
 * Two peak periods covering the same night is legal — a narrow "New Year's Eve"
 * rule deliberately laid over a broad "Christmas week" one is a real pattern,
 * and the later-created period wins. It is also the easiest way to price a
 * night by accident. So overlaps are detected and shown rather than blocked.
 *
 * Ranges are half-open: 2–16 Oct and 16–20 Oct do NOT overlap, because the
 * 16th is a checkout morning in the first and a first night in the second.
 */
export function findOverlaps(
  overrides: Array<{ id: string; startDate: string; endDate: string; label: string | null }>,
): Map<string, string[]> {
  const clashes = new Map<string, string[]>();

  for (let i = 0; i < overrides.length; i += 1) {
    for (let j = i + 1; j < overrides.length; j += 1) {
      const a = overrides[i]!;
      const b = overrides[j]!;

      if (a.startDate < b.endDate && b.startDate < a.endDate) {
        clashes.set(a.id, [...(clashes.get(a.id) ?? []), b.label || 'another period']);
        clashes.set(b.id, [...(clashes.get(b.id) ?? []), a.label || 'another period']);
      }
    }
  }

  return clashes;
}

function nightsBetween(start: string, end: string): number {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  return Math.round((to - from) / 86_400_000);
}

function PeakTable({
  overrides,
  isLoading,
  onEdit,
  onRemove,
  removing,
  editingId,
}: {
  overrides: RateOverride[];
  isLoading: boolean;
  onEdit: (override: RateOverride) => void;
  onRemove: (id: string) => void;
  removing: boolean;
  editingId: string | null;
}) {
  const clashes = findOverlaps(overrides);
  const today = new Date().toISOString().slice(0, 10);

  if (isLoading) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
    );
  }

  if (overrides.length === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">
          No peak periods yet. Standard rates apply on every date.
        </p>
      </div>
    );
  }

  return (
    <>
      {clashes.size > 0 && (
        <div
          className="mt-4 flex items-start gap-3 rounded-xl border border-[#d8a24a]/40 bg-[#d8a24a]/10 p-4"
          role="status"
        >
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-[#8a6320]" />
          <p className="text-sm leading-6 text-[#6b4d18]">
            {clashes.size} period{clashes.size === 1 ? '' : 's'} overlap. On a
            shared night the <strong>lower row wins</strong> — it was added
            later. Remove one if that isn't what you intended.
          </p>
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-[.08em] text-muted-foreground">
              <th className="px-5 py-3 font-bold">Period</th>
              <th className="px-5 py-3 font-bold">Dates</th>
              <th className="px-5 py-3 text-right font-bold">Nights</th>
              <th className="px-5 py-3 font-bold">Pricing</th>
              <th className="px-5 py-3 text-right font-bold">1 guest</th>
              <th className="px-5 py-3 text-right font-bold">2 guests</th>
              <th className="px-5 py-3 text-right font-bold">4 guests</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {overrides.map((override) => {
              const overlapping = clashes.get(override.id);
              const past = override.endDate <= today;

              return (
                <tr
                  key={override.id}
                  className={`border-b border-border last:border-0 ${editingId === override.id ? 'bg-primary/5 ring-1 ring-inset ring-primary/30' : overlapping ? 'bg-[#d8a24a]/5' : ''} ${past ? 'opacity-55' : ''}`}
                  data-testid={`row-peak-${override.id}`}
                >
                  <td className="px-5 py-3">
                    <span className="font-semibold text-primary">
                      {override.label || 'Peak period'}
                    </span>
                    {past && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        past
                      </span>
                    )}
                    {overlapping && (
                      <span
                        className="mt-1 block text-[11px] leading-4 text-[#8a6320]"
                        data-testid={`overlap-${override.id}`}
                      >
                        Overlaps {overlapping.join(', ')}
                      </span>
                    )}
                  </td>

                  <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">
                    {format(parseISO(override.startDate), 'd MMM')} →{' '}
                    {format(parseISO(override.endDate), 'd MMM yyyy')}
                  </td>

                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                    {nightsBetween(override.startDate, override.endDate)}
                  </td>

                  <td className="px-5 py-3">
                    {override.mode === 'percent' && (
                      <span className="text-foreground">
                        +{override.percent}% over standard
                      </span>
                    )}
                    {override.mode === 'fixed' && (
                      <span className="text-foreground">Exact prices</span>
                    )}
                    {override.mode === 'demand' && (
                      <span className="text-foreground">
                        {override.minPercent}–{override.maxPercent}% by demand
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          {override.enquiryCount ?? 0} of{' '}
                          {override.demandThreshold} enquiries · now +
                          {override.effectivePercent ?? override.minPercent}%
                        </span>
                      </span>
                    )}
                  </td>

                  {[1, 2, 4].map((guests) => {
                    const amount = override.amounts[String(guests)];
                    return (
                      <td
                        key={guests}
                        className="px-5 py-3 text-right tabular-nums"
                      >
                        {typeof amount === 'number' ? (
                          <span className="font-semibold text-primary">
                            {formatRupees(amount)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">
                            standard
                          </span>
                        )}
                      </td>
                    );
                  })}

                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onEdit(override)}
                        className="rounded-full border border-border p-1.5 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                        aria-label={`Edit ${override.label || 'peak period'}`}
                        data-testid={`button-edit-peak-${override.id}`}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(override.id)}
                        disabled={removing}
                        className="rounded-full border border-border p-1.5 text-muted-foreground transition-colors hover:border-[#A65E45] hover:text-[#A65E45] disabled:opacity-50"
                        aria-label={`Remove ${override.label || 'peak period'}`}
                        data-testid={`button-delete-peak-${override.id}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
