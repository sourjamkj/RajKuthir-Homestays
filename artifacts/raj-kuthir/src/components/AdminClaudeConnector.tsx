import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Loader2, Sparkles } from 'lucide-react';

import { adminFetch } from '@/lib/admin-api';

/**
 * The Claude connector on the owner console: whether Claude is connected,
 * how to connect it, and a button that disconnects it everywhere. The same
 * card is in the phone app's Settings.
 */

type Status = { url: string; connected: boolean; since: string | null; lastUsed: string | null };
const KEY = ['/api/admin/claude-connector'];

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';

export function AdminClaudeConnector() {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const status = useQuery({ queryKey: KEY, queryFn: () => adminFetch<Status>('/api/admin/claude-connector'), retry: false });
  const disconnect = useMutation({
    mutationFn: () => adminFetch('/api/admin/claude-connector/disconnect', { method: 'POST', body: '{}' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
  const url = status.data?.url ?? 'https://rajkuthirhomestays.casa/mcp';

  return (
    <section className="mt-10 rounded-2xl border border-border bg-card p-5" aria-label="Claude connector" data-testid="card-claude-connector">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[640px]">
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-accent">
            <Sparkles size={13} /> Claude connector
          </p>
          <p className="mt-1 text-sm leading-6 text-foreground">
            Lets Claude add and edit enquiries (with your agreed price), send quotes, mark advances, create bookings and change the rate card
            (it shows old and new prices before saving; every change is in the activity log). It cannot change settings, money records or
            signed-in phones.
          </p>
          {status.data?.connected ? (
            <p className="mt-2 text-sm font-medium text-[#4b5340]" data-testid="text-claude-connected">
              Connected{status.data.lastUsed ? ` · last used ${when(status.data.lastUsed)}` : ''}
            </p>
          ) : (
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
              <li>In Claude, open Settings → Connectors → Add custom connector.</li>
              <li>
                Name it Raj Kuthir and paste this address:{' '}
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(url).then(() => setCopied(true));
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 font-mono-ui text-[12px] text-primary hover:border-primary"
                  data-testid="button-copy-connector-url"
                >
                  {url} {copied ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </li>
              <li>Press Connect. Your site opens: enter your admin password there and press Allow.</li>
            </ol>
          )}
          {status.isError && <p className="mt-2 text-xs text-[#A65E45]">Could not check the connector just now.</p>}
        </div>
        {status.data?.connected && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Disconnect Claude? It will stop working with your console until you connect it again.')) disconnect.mutate();
            }}
            disabled={disconnect.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-[#A65E45]/40 px-3 py-2 text-[10px] font-bold uppercase tracking-[.07em] text-[#A65E45] hover:border-[#A65E45] disabled:opacity-40"
            data-testid="button-disconnect-claude"
          >
            {disconnect.isPending && <Loader2 size={12} className="animate-spin" />} Disconnect Claude
          </button>
        )}
      </div>
    </section>
  );
}
