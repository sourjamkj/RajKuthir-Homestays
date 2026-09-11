import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Client for the owner console. Auth is a signed HttpOnly cookie set by
 * POST /api/admin/login, so there is no token to hold in JavaScript — the
 * browser attaches it to same-origin requests automatically.
 */

export const ADMIN_SESSION_KEY = ['/api/admin/me'];
export const CALENDAR_EVENTS_KEY = ['/api/calendar/events'];
export const CALENDAR_PUBLIC_KEY = ['/api/calendar/public'];
export const SYNC_STATUS_KEY = ['/api/calendar/sync-status'];
export const FEED_INFO_KEY = ['/api/calendar/feed-info'];
export const FEED_SOURCES_KEY = ['/api/calendar/feed-sources'];
export const MAIL_ACCOUNTS_KEY = ['/api/mail/accounts'];

export type AdminSession = {
  signedIn: boolean;
  /** False when the server has no admin password configured yet. */
  configured: boolean;
};

export type SyncSourceStatus = {
  source: 'bookingCom' | 'airbnb' | 'makeMyTrip';
  label: string;
  status: 'connected' | 'missing' | 'error';
  eventCount: number;
  message: string;
  lastSyncedAt: string | null;
};

export type SyncStatusResponse = {
  syncedAt: string | null;
  totalEvents: number;
  sources: SyncSourceStatus[];
};

export type FeedInfoResponse = {
  feedUrl: string;
  bookingCom: string;
  airbnb: string;
  makeMyTrip: string;
};

export class AdminApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
  }
}

/**
 * Whether the last failure was an expired session.
 *
 * A module-level flag rather than router state or a query parameter: the
 * redirect is triggered deep inside a data query, far from any component that
 * could pass a message along, and a ?expired=1 in the URL would survive
 * bookmarking and reappear at confusing moments. Read once, then cleared.
 */
let sessionExpired = false;

export function markSessionExpired(): void {
  sessionExpired = true;
}

/** Reads the flag and clears it, so the notice shows exactly once. */
export function consumeSessionExpired(): boolean {
  const was = sessionExpired;
  sessionExpired = false;
  return was;
}

export async function adminFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}) as { error?: string });
    throw new AdminApiError(
      typeof body.error === 'string'
        ? body.error
        : `Request failed (${response.status})`,
      response.status,
    );
  }

  return response.status === 204 ? (undefined as T) : response.json();
}

export function useAdminSession() {
  return useQuery({
    queryKey: ADMIN_SESSION_KEY,
    queryFn: () => adminFetch<AdminSession>('/api/admin/me'),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: true,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (password: string) =>
      adminFetch<{ signedIn: boolean }>('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
    onSuccess: () => {
      // Everything behind the guard is now fetchable.
      queryClient.invalidateQueries();
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      adminFetch<{ signedIn: boolean }>('/api/admin/logout', {
        method: 'POST',
      }),
    onSuccess: () => {
      // Drop every cached admin response so nothing survives sign-out.
      queryClient.clear();
    },
  });
}

export function useSyncStatus(enabled: boolean) {
  return useQuery({
    queryKey: SYNC_STATUS_KEY,
    queryFn: () => adminFetch<SyncStatusResponse>('/api/calendar/sync-status'),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export function useRunSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      adminFetch<SyncStatusResponse>('/api/calendar/sync', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(SYNC_STATUS_KEY, {
        syncedAt: result.syncedAt,
        totalEvents: result.totalEvents,
        sources: result.sources,
      });
      queryClient.invalidateQueries({ queryKey: CALENDAR_EVENTS_KEY });
      queryClient.invalidateQueries({ queryKey: CALENDAR_PUBLIC_KEY });
    },
  });
}

export type FeedSource = {
  source: 'bookingCom' | 'airbnb' | 'makeMyTrip';
  label: string;
  url: string;
  /** True when nothing is saved but an environment variable is still supplying a URL. */
  usingEnvFallback: boolean;
};

export function useFeedSources(enabled: boolean) {
  return useQuery({
    queryKey: FEED_SOURCES_KEY,
    queryFn: () =>
      adminFetch<{ sources: FeedSource[] }>('/api/calendar/feed-sources'),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

export function useSaveFeedSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ source, url }: { source: string; url: string }) =>
      adminFetch<{ saved: boolean }>(`/api/calendar/feed-sources/${source}`, {
        method: 'PUT',
        body: JSON.stringify({ url }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FEED_SOURCES_KEY });
    },
  });
}

export function useFeedInfo(enabled: boolean) {
  return useQuery({
    queryKey: FEED_INFO_KEY,
    queryFn: () => adminFetch<FeedInfoResponse>('/api/calendar/feed-info'),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/* ---------------------------------------------------------------------- *
 * Booking emails
 *
 * Some channels announce a booking by email rather than by putting it on a
 * calendar feed, so the server reads a mailbox over IMAP and parses the
 * vouchers. These hooks drive that from the owner console.
 *
 * Note what is missing: there is no hook that reads a mailbox password back.
 * The server has no endpoint for it either — a password can be written and
 * replaced, never retrieved. `MailAccount` is the whole of what the browser
 * is ever told about a mailbox.
 * ---------------------------------------------------------------------- */

export type MailAccount = {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  folder: string;
  enabled: boolean;
  /** Highest IMAP message number already read, so mail is never read twice. */
  lastSeenUid: number;
  lastCheckedAt: string | null;
  lastError: string | null;
};

export type MailSyncAccountResult = {
  accountId: string;
  label: string;
  status: 'ok' | 'error';
  scanned: number;
  matched: number;
  imported: number;
  uidValidityReset: boolean;
  highestUid: number;
  message: string;
};

export type MailSyncResult = {
  syncedAt: string;
  accounts: MailSyncAccountResult[];
  imported: number;
};

export type MailAccountsResponse = {
  accounts: MailAccount[];
  /** False when MAIL_ENCRYPTION_KEY is unusable; nothing can sync until it is. */
  encryptionConfigured: boolean;
  /** Why it is unusable, in words. Never contains any part of the key. */
  encryptionProblem: string | null;
  lastSync: MailSyncResult | null;
  running: boolean;
};

export type NewMailbox = {
  label: string;
  host: string;
  port: number;
  username: string;
  password: string;
  folder: string;
  secure: boolean;
};

export function useMailAccounts(enabled: boolean) {
  return useQuery({
    queryKey: MAIL_ACCOUNTS_KEY,
    queryFn: () => adminFetch<MailAccountsResponse>('/api/mail/accounts'),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export function useAddMailbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (mailbox: NewMailbox) =>
      adminFetch<{ account: MailAccount }>('/api/mail/accounts', {
        method: 'POST',
        body: JSON.stringify(mailbox),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MAIL_ACCOUNTS_KEY });
    },
  });
}

/**
 * Changes one mailbox. Send only the fields that changed.
 *
 * An omitted or empty `password` leaves the stored one untouched — the server
 * treats a blank field as "leave it alone" rather than "erase it", so the
 * form can safely post without one.
 */
export function useUpdateMailbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: { id: string } & Partial<Omit<NewMailbox, 'secure'>> & {
        enabled?: boolean;
      }) =>
      adminFetch<{ account: MailAccount }>(`/api/mail/accounts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MAIL_ACCOUNTS_KEY });
    },
  });
}

export function useDeleteMailbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      adminFetch<{ deleted: boolean }>(`/api/mail/accounts/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MAIL_ACCOUNTS_KEY });
    },
  });
}

/**
 * Forgets how far this mailbox was read, so the next check starts from the
 * beginning of the folder. For after a parser fix, when mail that was passed
 * over needs a second look. Safe to run: a booking is saved against the
 * channel's own reference, so re-reading the same mail cannot duplicate it.
 */
export function useRewindMailbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      adminFetch<{ rewound: boolean }>(`/api/mail/accounts/${id}/rewind`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MAIL_ACCOUNTS_KEY });
    },
  });
}

export function useRunMailSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      adminFetch<{ result: MailSyncResult }>('/api/mail/sync', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MAIL_ACCOUNTS_KEY });
      // An imported booking becomes a calendar event, so the calendar and the
      // sync counters on this page are both stale now.
      queryClient.invalidateQueries({ queryKey: CALENDAR_EVENTS_KEY });
      queryClient.invalidateQueries({ queryKey: SYNC_STATUS_KEY });
    },
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Never';

  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
