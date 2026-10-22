import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Check, MessageCircle, X } from 'lucide-react';

import { adminFetch } from '@/lib/admin-api';

/**
 * Messages for the caretaker that are due now — new booking, arriving
 * tomorrow, leaving tomorrow, cancelled. "Send on WhatsApp" opens WhatsApp
 * with the message ready and marks it sent; "Skip" clears it without sending.
 * Nothing goes out on its own: the owner sends each one from their phone.
 */

export const CARETAKER_KEY = ['/api/admin/caretaker/queue'];

type Item = {
  bookingId: string;
  kind: 'new_booking' | 'checkin_eve' | 'checkout_eve' | 'cancelled';
  guestName: string | null;
  checkIn: string;
  checkOut: string;
  text: string;
  whatsappUrl: string | null;
};

const LABEL: Record<Item['kind'], string> = {
  new_booking: 'New booking',
  checkin_eve: 'Arrives tomorrow',
  checkout_eve: 'Leaves tomorrow',
  cancelled: 'Cancelled',
};

const day = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y!, m! - 1, d!)));
};

export function AdminCaretaker() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: CARETAKER_KEY,
    queryFn: () => adminFetch<{ items: Item[] }>('/api/admin/caretaker/queue'),
    refetchInterval: 5 * 60_000,
  });

  const mark = useMutation({
    mutationFn: ({ item, outcome }: { item: Item; outcome: 'sent' | 'skipped' }) =>
      adminFetch(`/api/admin/caretaker/${item.bookingId}/${item.kind}`, {
        method: 'POST',
        body: JSON.stringify({ outcome }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CARETAKER_KEY }),
  });

  const items = query.data?.items ?? [];
  if (query.isLoading || items.length === 0) return null;

  return (
    <section id="caretaker" className="mb-8 scroll-mt-6 rounded-2xl border border-accent/40 bg-card p-5" aria-label="Caretaker messages" data-testid="section-caretaker">
      <div className="flex items-center gap-2">
        <BellRing size={16} className="text-accent" />
        <h2 className="font-journal text-2xl text-primary">Tell the caretaker · {items.length}</h2>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">Tap to open WhatsApp with the message ready to send to the caretaker.</p>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={`${item.bookingId}:${item.kind}`} className="rounded-xl border border-border bg-background p-3" data-testid={`row-caretaker-${item.kind}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-primary">
                <span className={`mr-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.08em] ${item.kind === 'cancelled' ? 'bg-[#A65E45] text-white' : 'bg-secondary text-primary'}`}>{LABEL[item.kind]}</span>
                {item.guestName ?? 'Guest'} · {day(item.checkIn)} → {day(item.checkOut)}
              </p>
              <div className="flex gap-2">
                {item.whatsappUrl && (
                  <a
                    href={item.whatsappUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => mark.mutate({ item, outcome: 'sent' })}
                    className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[11px] font-bold uppercase tracking-[.08em] text-primary-foreground"
                    data-testid="button-caretaker-send"
                  >
                    <MessageCircle size={13} /> Send on WhatsApp
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => mark.mutate({ item, outcome: 'skipped' })}
                  className="flex items-center gap-1 rounded-full border border-border px-3 py-2 text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground"
                  data-testid="button-caretaker-skip"
                >
                  <X size={12} /> Skip
                </button>
              </div>
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-muted-foreground">Preview message</summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-[12px] text-primary/80">{item.text}</pre>
            </details>
          </li>
        ))}
      </ul>
      {mark.isSuccess && <p className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground"><Check size={12} /> Marked.</p>}
    </section>
  );
}
