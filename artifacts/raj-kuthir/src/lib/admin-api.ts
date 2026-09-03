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

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Never';

  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
