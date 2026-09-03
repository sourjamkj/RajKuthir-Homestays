import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { format, isAfter, parseISO, startOfToday } from 'date-fns';
import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  Link as LinkIcon,
  Loader2,
  LogOut,
  RefreshCw,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { AdminCalendar } from '@/components/AdminCalendar';
import {
  adminFetch,
  formatDateTime,
  useAdminSession,
  useFeedInfo,
  useFeedSources,
  useLogout,
  useRunSync,
  useSaveFeedSource,
  useSyncStatus,
  CALENDAR_EVENTS_KEY,
  type FeedSource,
  type SyncSourceStatus,
} from '@/lib/admin-api';

type CalendarEventDto = {
  id: string;
  source: 'manual' | 'direct' | 'bookingCom' | 'airbnb' | 'makeMyTrip';
  startDate: string;
  endDate: string;
  title: string | null;
  editable: boolean;
};

const STATUS_STYLES: Record<
  SyncSourceStatus['status'],
  { chip: string; label: string }
> = {
  connected: {
    chip: 'bg-[#7A8065]/15 text-[#4b5340] border-[#7A8065]/30',
    label: 'Connected',
  },
  missing: {
    chip: 'bg-muted text-muted-foreground border-border',
    label: 'Not connected',
  },
  error: {
    chip: 'bg-[#A65E45]/10 text-[#A65E45] border-[#A65E45]/30',
    label: 'Error',
  },
};

export default function AdminDashboard() {
  const [, navigate] = useLocation();
  const session = useAdminSession();
  const logout = useLogout();

  const signedIn = session.data?.signedIn === true;

  // Bounce to the login page if the cookie is missing or has expired.
  useEffect(() => {
    if (session.isSuccess && !signedIn) navigate('/admin/login', { replace: true });
  }, [session.isSuccess, signedIn, navigate]);

  const syncStatus = useSyncStatus(signedIn);
  const runSync = useRunSync();
  const feedInfo = useFeedInfo(signedIn);
  const feedSources = useFeedSources(signedIn);

  const events = useQuery({
    queryKey: CALENDAR_EVENTS_KEY,
    queryFn: () => adminFetch<{ events: CalendarEventDto[] }>('/api/calendar/events'),
    enabled: signedIn,
    retry: false,
    staleTime: 30_000,
  });

  const stats = useMemo(() => {
    const all = events.data?.events ?? [];
    const today = startOfToday();
    const upcoming = all
      .filter((event) => isAfter(parseISO(event.endDate), today))
      .sort((left, right) => left.startDate.localeCompare(right.startDate));

    return {
      total: all.length,
      upcoming: upcoming.length,
      nextArrival: upcoming[0] ?? null,
    };
  }, [events.data?.events]);

  if (session.isLoading || (session.isSuccess && !signedIn)) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 px-5 py-5 md:px-8">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.14em] text-accent">
              Owner console
            </p>
            <h1 className="mt-1 font-journal text-2xl text-primary md:text-3xl">
              Raj Kuthir — Sobuj Potro
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="/admin/earnings"
              className="rounded-full border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-[.09em] text-primary transition-colors hover:border-primary"
              data-testid="link-admin-earnings"
            >
              Earnings
            </a>
            <a
              href="/admin/rates"
              className="rounded-full border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-[.09em] text-primary transition-colors hover:border-primary"
              data-testid="link-admin-rates"
            >
              Rates
            </a>
            <a
              href="/"
              className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-[.09em] text-primary transition-colors hover:border-primary"
              data-testid="link-view-site"
            >
              View site <ArrowUpRight size={13} />
            </a>
            <button
              type="button"
              onClick={() =>
                logout.mutate(undefined, {
                  onSuccess: () => navigate('/admin/login', { replace: true }),
                })
              }
              disabled={logout.isPending}
              className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[11px] font-bold uppercase tracking-[.09em] text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-60"
              data-testid="button-admin-sign-out"
            >
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-5 py-8 md:px-8 md:py-10">
        <section
          className="grid gap-4 sm:grid-cols-3"
          aria-label="Booking summary"
        >
          <StatCard
            label="Upcoming bookings"
            value={events.isLoading ? '—' : String(stats.upcoming)}
          />
          <StatCard
            label="Next arrival"
            value={
              events.isLoading
                ? '—'
                : stats.nextArrival
                  ? format(parseISO(stats.nextArrival.startDate), 'd MMM yyyy')
                  : 'None booked'
            }
          />
          <StatCard
            label="Last synced"
            value={formatDateTime(syncStatus.data?.syncedAt)}
          />
        </section>

        <FeedSourcesPanel
          sources={feedSources.data?.sources}
          isLoading={feedSources.isLoading}
        />

        <SyncPanel
          data={syncStatus.data}
          isLoading={syncStatus.isLoading}
          isSyncing={runSync.isPending}
          error={runSync.error}
          onSync={() => runSync.mutate()}
        />

        <section className="mt-6" aria-label="Calendar">
          <SectionHeading
            icon={<CalendarDays size={15} />}
            title="Calendar"
            description="Every booking across all channels. Select nights to block for a direct booking, family stay, or maintenance."
          />
          <div className="mt-4">
            <AdminCalendar />
          </div>
        </section>

        <FeedPanel
          data={feedInfo.data}
          isLoading={feedInfo.isLoading}
          error={feedInfo.error}
        />
      </main>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 font-journal text-2xl text-primary">{value}</p>
    </div>
  );
}

function SectionHeading({
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

function FeedSourcesPanel({
  sources,
  isLoading,
}: {
  sources: FeedSource[] | undefined;
  isLoading: boolean;
}) {
  return (
    <section className="mt-6" aria-label="Channel connections">
      <SectionHeading
        icon={<LinkIcon size={15} />}
        title="Channel connections"
        description="Paste each channel's calendar export (iCal) link here so their bookings flow into your calendar. Find it in that channel's own dashboard under calendar sync or export. Saved here — no redeploy needed."
      />

      <div className="mt-4 space-y-3">
        {isLoading
          ? [0, 1, 2].map((key) => (
              <div
                key={key}
                className="h-[86px] animate-pulse rounded-2xl border border-border bg-card"
              />
            ))
          : (sources ?? []).map((source) => (
              <FeedSourceRow key={source.source} source={source} />
            ))}
      </div>
    </section>
  );
}

function FeedSourceRow({ source }: { source: FeedSource }) {
  const [value, setValue] = useState(source.url);
  const [touched, setTouched] = useState(false);
  const save = useSaveFeedSource();

  // Re-seed from the server when this row is not being edited, so a refetch
  // does not clobber what the owner is typing.
  useEffect(() => {
    if (!touched) setValue(source.url);
  }, [source.url, touched]);

  const dirty = value.trim() !== source.url.trim();

  const submit = () => {
    if (!dirty || save.isPending) return;
    save.mutate(
      { source: source.source, url: value.trim() },
      { onSuccess: () => setTouched(false) },
    );
  };

  const errorMessage =
    save.error instanceof Error ? save.error.message : null;

  return (
    <div
      className="rounded-2xl border border-border bg-card p-5"
      data-testid={`row-feed-source-${source.source}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          htmlFor={`feed-url-${source.source}`}
          className="text-sm font-bold text-primary"
        >
          {source.label}
        </label>

        {source.url ? (
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[.07em] text-[#4b5340]">
            <Check size={11} /> Saved
          </span>
        ) : source.usingEnvFallback ? (
          <span className="text-[10px] font-bold uppercase tracking-[.07em] text-muted-foreground">
            Using server variable
          </span>
        ) : (
          <span className="text-[10px] font-bold uppercase tracking-[.07em] text-muted-foreground">
            Not set
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          id={`feed-url-${source.source}`}
          type="url"
          inputMode="url"
          value={value}
          placeholder="https://…  paste the iCal export link"
          onChange={(event) => {
            setTouched(true);
            setValue(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2.5 font-mono-ui text-[11px] text-foreground outline-none transition-colors focus:border-primary"
          data-testid={`input-feed-url-${source.source}`}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!dirty || save.isPending}
          className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-[11px] font-bold uppercase tracking-[.07em] text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40"
          data-testid={`button-save-feed-${source.source}`}
        >
          {save.isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : save.isSuccess && !dirty ? (
            <Check size={13} />
          ) : null}
          {save.isPending ? 'Saving' : save.isSuccess && !dirty ? 'Saved' : 'Save'}
        </button>
      </div>

      {errorMessage && (
        <p className="mt-2 text-xs text-[#A65E45]" role="alert">
          {errorMessage}
        </p>
      )}

      {!value && source.usingEnvFallback && (
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
          A URL is currently set on the server. Paste one here to override it.
        </p>
      )}
    </div>
  );
}

function SyncPanel({
  data,
  isLoading,
  isSyncing,
  error,
  onSync,
}: {
  data: { sources: SyncSourceStatus[] } | undefined;
  isLoading: boolean;
  isSyncing: boolean;
  error: unknown;
  onSync: () => void;
}) {
  return (
    <section className="mt-6" aria-label="Channel sync">
      <SectionHeading
        icon={<RefreshCw size={15} />}
        title="Channel sync"
        description="Your OTA calendars import automatically every 2 hours. Use this to pull them in right now."
        action={
          <button
            type="button"
            onClick={onSync}
            disabled={isSyncing}
            className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[11px] font-bold uppercase tracking-[.09em] text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-70"
            data-testid="button-sync-now"
          >
            <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Syncing' : 'Sync now'}
          </button>
        }
      />

      {error instanceof Error && (
        <p className="mt-3 text-xs text-[#A65E45]" role="alert">
          {error.message}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {isLoading
          ? [0, 1, 2].map((key) => (
              <div
                key={key}
                className="h-[124px] animate-pulse rounded-2xl border border-border bg-card"
              />
            ))
          : (data?.sources ?? []).map((source) => {
              const style = STATUS_STYLES[source.status];
              return (
                <div
                  key={source.source}
                  className="rounded-2xl border border-border bg-card p-5"
                  data-testid={`card-source-${source.source}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-primary">
                      {source.label}
                    </p>
                    <span
                      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.07em] ${style.chip}`}
                    >
                      {source.status === 'connected' && <Check size={11} />}
                      {source.status === 'error' && <AlertCircle size={11} />}
                      {source.status === 'missing' && <CircleAlert size={11} />}
                      {style.label}
                    </span>
                  </div>

                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    {source.message}
                  </p>

                  <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-[10px] uppercase tracking-[.07em] text-muted-foreground">
                    <span>{source.eventCount} dates</span>
                    <span>{formatDateTime(source.lastSyncedAt)}</span>
                  </div>
                </div>
              );
            })}
      </div>
    </section>
  );
}

function FeedPanel({
  data,
  isLoading,
  error,
}: {
  data:
    | { feedUrl: string; bookingCom: string; airbnb: string; makeMyTrip: string }
    | undefined;
  isLoading: boolean;
  error: unknown;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const links = data
    ? [
        {
          key: 'bookingCom',
          label: 'Give this to Booking.com',
          url: data.bookingCom,
        },
        { key: 'airbnb', label: 'Give this to Airbnb', url: data.airbnb },
        {
          key: 'makeMyTrip',
          label: 'Give this to MakeMyTrip',
          url: data.makeMyTrip,
        },
        { key: 'all', label: 'All sources (personal use)', url: data.feedUrl },
      ]
    : [];

  const copy = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  };

  return (
    <section className="mt-8 pb-4" aria-label="Outbound calendar feeds">
      <SectionHeading
        icon={<ExternalLink size={15} />}
        title="Your export links"
        description="Paste each link into that channel's own 'import calendar' field. Each one deliberately leaves out that channel's own bookings, so they never echo back and double-count."
      />

      <div className="mt-4 rounded-2xl border border-border bg-card p-5 md:p-6">
        {isLoading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={15} className="animate-spin" /> Loading your feed
            links…
          </p>
        )}

        {error instanceof Error && (
          <p className="text-sm text-[#A65E45]" role="alert">
            {error.message}
          </p>
        )}

        {links.length > 0 && (
          <div className="space-y-4">
            {links.map((link) => (
              <div key={link.key}>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">
                  {link.label}
                </p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={link.url}
                    onFocus={(event) => event.currentTarget.select()}
                    className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2.5 font-mono-ui text-[11px] text-foreground outline-none"
                    aria-label={link.label}
                    data-testid={`input-feed-${link.key}`}
                  />
                  <button
                    type="button"
                    onClick={() => copy(link.key, link.url)}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-[.07em] text-primary-foreground transition-transform hover:-translate-y-0.5"
                    aria-label={`Copy ${link.label}`}
                    data-testid={`button-copy-feed-${link.key}`}
                  >
                    {copied === link.key ? (
                      <Check size={13} />
                    ) : (
                      <Copy size={13} />
                    )}
                    {copied === link.key ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            ))}

            <p className="border-t border-border pt-4 text-[11px] leading-5 text-muted-foreground">
              Keep these private. Anyone with a link can read your blocked
              dates.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
