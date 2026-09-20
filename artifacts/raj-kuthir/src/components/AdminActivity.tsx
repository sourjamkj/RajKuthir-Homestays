import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import { Bell, CalendarDays, CalendarPlus, CalendarX, FileCheck, Inbox, Loader2, X } from 'lucide-react';

import { adminFetch } from '@/lib/admin-api';

/**
 * The bell in the owner console header: what has happened since the owner
 * last marked it read — new bookings from any channel, cancellations, OTA
 * calendar blocks, website enquiries and guest ID uploads.
 *
 * The "last read" marker lives on the server, so clearing it on the phone
 * clears it on the laptop too. The panel opens by itself once per browser
 * session when there is something unread, which is what "tell me when I log
 * in" amounts to; after that it waits behind the bell.
 */

type ActivityKind =
  | 'booking_new'
  | 'booking_cancelled'
  | 'ota_block'
  | 'enquiry_new'
  | 'documents_uploaded';

type ActivityItem = {
  id: string;
  kind: ActivityKind;
  at: string;
  title: string;
  detail: string;
  href: string;
};

const ACTIVITY_KEY = ['/api/admin/activity'];
const AUTO_OPENED = 'rk_activity_auto_opened';

const ICONS: Record<ActivityKind, typeof Bell> = {
  booking_new: CalendarPlus,
  booking_cancelled: CalendarX,
  ota_block: CalendarDays,
  enquiry_new: Inbox,
  documents_uploaded: FileCheck,
};

/** Cancellations are the one thing that may need undoing elsewhere. */
const TONE: Record<ActivityKind, string> = {
  booking_new: 'bg-[#7A8065]/15 text-[#4b5340]',
  booking_cancelled: 'bg-[#A65E45]/10 text-[#A65E45]',
  ota_block: 'bg-[#d8a24a]/15 text-[#8a6320]',
  enquiry_new: 'bg-primary/10 text-primary',
  documents_uploaded: 'bg-[#7A8065]/15 text-[#4b5340]',
};

export function AdminActivity() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const activity = useQuery({
    queryKey: ACTIVITY_KEY,
    queryFn: () => adminFetch<{ since: string; items: ActivityItem[] }>('/api/admin/activity'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const items = activity.data?.items ?? [];

  useEffect(() => {
    if (items.length === 0) return;
    try {
      if (sessionStorage.getItem(AUTO_OPENED)) return;
      sessionStorage.setItem(AUTO_OPENED, '1');
    } catch {
      /* private mode: still open once per page load */
    }
    setOpen(true);
    // Only the first non-empty load should open it.
  }, [items.length > 0]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    const onClick = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const markRead = useMutation({
    // The newest item shown, not "now": anything arriving in between stays unread.
    mutationFn: () =>
      adminFetch('/api/admin/activity/seen', {
        method: 'POST',
        body: JSON.stringify({ upTo: items[0]?.at }),
      }),
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ACTIVITY_KEY });
    },
  });

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative grid h-9 w-9 place-items-center rounded-full border border-border text-primary transition-colors hover:border-primary"
        aria-label={items.length ? `${items.length} new since you last looked` : 'Activity — nothing new'}
        aria-expanded={open}
        data-testid="button-admin-activity"
      >
        <Bell size={15} />
        {items.length > 0 && (
          <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#A65E45] px-1 text-[10px] font-bold tabular-nums text-white" data-testid="badge-admin-activity">
            {items.length > 49 ? '50+' : items.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-11 z-50 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
          role="dialog"
          aria-label="Recent activity"
          data-testid="panel-admin-activity"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.12em] text-accent">Since you last looked</p>
              <p className="mt-0.5 text-sm font-medium text-primary">
                {items.length === 0 ? 'Nothing new' : `${items.length} new ${items.length === 1 ? 'update' : 'updates'}`}
              </p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1.5 text-muted-foreground hover:text-primary" aria-label="Close">
              <X size={14} />
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {activity.isLoading && <p className="px-4 py-5 text-sm text-muted-foreground">Loading…</p>}
            {activity.isError && (
              <p className="px-4 py-5 text-sm text-[#A65E45]">
                {activity.error instanceof Error ? activity.error.message : 'Could not load recent activity.'}
              </p>
            )}
            {!activity.isLoading && !activity.isError && items.length === 0 && (
              <p className="px-4 py-5 text-sm text-muted-foreground">You are up to date. New bookings, enquiries and uploads will show here.</p>
            )}
            <ul>
              {items.map((item) => {
                const Icon = ICONS[item.kind];
                return (
                  <li key={item.id} className="border-b border-border last:border-0">
                    <a href={item.href} className="flex gap-3 px-4 py-3 transition-colors hover:bg-background/60" data-testid={`activity-${item.id}`}>
                      <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${TONE[item.kind]}`}>
                        <Icon size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium text-foreground">{item.title}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {formatDistanceToNowStrict(parseISO(item.at), { addSuffix: true })}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{item.detail}</span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>

          {items.length > 0 && (
            <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
              {markRead.isError ? (
                <p className="text-xs text-[#A65E45]">Could not mark as read.</p>
              ) : (
                <span className="text-[11px] text-muted-foreground">Stays here until you mark it read.</span>
              )}
              <button
                type="button"
                onClick={() => markRead.mutate()}
                disabled={markRead.isPending}
                className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[10px] font-bold uppercase tracking-[.09em] text-primary-foreground disabled:opacity-50"
                data-testid="button-activity-mark-read"
              >
                {markRead.isPending && <Loader2 size={12} className="animate-spin" />} Mark all read
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
