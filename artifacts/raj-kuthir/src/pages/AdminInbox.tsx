import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, MessageCircle, Send, UserRound } from 'lucide-react';

import { adminFetch } from '@/lib/admin-api';
import { AdminHeader } from '@/components/AdminHeader';

/**
 * WhatsApp inbox for +91 84201 13934. The number runs on the Business API,
 * so it cannot be opened in the WhatsApp app: guests' chats are read and
 * answered here. Each chat is answered by the assistant or by you; replying
 * yourself takes the chat over for 24 hours.
 */

type Conversation = {
  phone: string;
  state: 'bot' | 'human';
  mutedUntil: string | null;
  lastInboundAt: string | null;
  lastText: string | null;
  lastDirection: 'inbound' | 'outbound' | null;
  lastAt: string | null;
};
type Message = { id: string; direction: 'inbound' | 'outbound'; type: string; text: string | null; status: string | null; at: string };

const LIST_KEY = ['/api/admin/wa/conversations'];
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
const ownerHas = (c: Conversation) => c.state === 'human' && !!c.mutedUntil && new Date(c.mutedUntil) > new Date();

export default function AdminInbox() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const list = useQuery({
    queryKey: LIST_KEY,
    queryFn: () => adminFetch<{ conversations: Conversation[] }>('/api/admin/wa/conversations'),
    refetchInterval: 15_000,
  });
  const thread = useQuery({
    queryKey: ['/api/admin/wa/conversations', selected],
    queryFn: () => adminFetch<{ messages: Message[] }>(`/api/admin/wa/conversations/${selected}`),
    enabled: !!selected,
    refetchInterval: 10_000,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    void queryClient.invalidateQueries({ queryKey: ['/api/admin/wa/conversations', selected] });
  };
  const sendReply = useMutation({
    mutationFn: () => adminFetch(`/api/admin/wa/conversations/${selected}/reply`, { method: 'POST', body: JSON.stringify({ text: draft }) }),
    onSuccess: () => {
      setDraft('');
      refresh();
    },
  });
  const setState = useMutation({
    mutationFn: (state: 'bot' | 'human') =>
      adminFetch(`/api/admin/wa/conversations/${selected}/state`, { method: 'POST', body: JSON.stringify({ state }) }),
    onSuccess: refresh,
  });

  const conversations = list.data?.conversations ?? [];
  const current = conversations.find((c) => c.phone === selected) ?? null;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <AdminHeader eyebrow="Owner console" title="WhatsApp inbox" />
      <main className="section-shell grid gap-6 py-10 md:grid-cols-[320px_1fr]">
        <section aria-label="Chats" className="rounded-2xl border border-border bg-card">
          {conversations.length === 0 && (
            <p className="p-5 text-sm text-muted-foreground">{list.isLoading ? 'Loading…' : 'No WhatsApp chats yet.'}</p>
          )}
          <ul>
            {conversations.map((c) => (
              <li key={c.phone}>
                <button
                  type="button"
                  onClick={() => setSelected(c.phone)}
                  className={`flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left ${selected === c.phone ? 'bg-primary/5' : ''}`}
                  data-testid={`chat-${c.phone}`}
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-semibold text-primary">
                    +{c.phone}
                    <span className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
                      {ownerHas(c) ? <UserRound size={12} /> : <Bot size={12} />}
                      {ownerHas(c) ? 'You' : 'Assistant'}
                    </span>
                  </span>
                  <span className="line-clamp-1 text-xs text-muted-foreground">
                    {c.lastDirection === 'outbound' ? '↩ ' : ''}
                    {c.lastText ?? '(media)'}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{when(c.lastAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Conversation" className="flex min-h-[60vh] flex-col rounded-2xl border border-border bg-card">
          {!current ? (
            <div className="m-auto flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <MessageCircle size={22} />
              Choose a chat. The assistant answers guests by itself; reply here to take a chat over.
            </div>
          ) : (
            <>
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
                <a href={`tel:+${current.phone}`} className="text-sm font-semibold text-primary">
                  +{current.phone}
                </a>
                <button
                  type="button"
                  onClick={() => setState.mutate(ownerHas(current) ? 'bot' : 'human')}
                  disabled={setState.isPending}
                  className="rounded-full border border-border px-4 py-1.5 text-[11px] font-bold uppercase tracking-[.08em] text-primary"
                >
                  {ownerHas(current) ? 'Hand back to assistant' : 'I will answer this chat'}
                </button>
              </header>
              <ol className="flex-1 space-y-2 overflow-y-auto p-5">
                {(thread.data?.messages ?? []).map((m) => (
                  <li key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                        m.direction === 'outbound' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                      }`}
                    >
                      {m.text ?? `(${m.type})`}
                      <span className="mt-1 block text-[10px] opacity-70">
                        {when(m.at)}
                        {m.status ? ` · ${m.status}` : ''}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
              <form
                className="flex gap-2 border-t border-border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (draft.trim()) sendReply.mutate();
                }}
              >
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={2}
                  placeholder="Reply as Raj Kuthir Homestays…"
                  aria-label="Reply"
                  className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={sendReply.isPending || !draft.trim()}
                  aria-label="Send reply"
                  className="flex items-center gap-1 self-end rounded-full bg-primary px-4 py-2 text-[11px] font-bold uppercase tracking-[.08em] text-primary-foreground disabled:opacity-50"
                >
                  <Send size={13} /> Send
                </button>
              </form>
              {sendReply.error && <p className="px-5 pb-3 text-xs text-destructive">{(sendReply.error as Error).message}</p>}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
