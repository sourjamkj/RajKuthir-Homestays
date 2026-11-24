import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, MessageSquare, RefreshCw, Send, UserRound } from 'lucide-react';

import { adminFetch } from '@/lib/admin-api';

type Conversation = {
  phone: string;
  state: 'bot' | 'human';
  lastInboundAt: string | null;
  lastMessageAt: string | null;
  lastMessageDirection: string | null;
  lastMessageText: string | null;
  lastMessageType: string | null;
  replyWindowOpen: boolean;
};

type InboxMessage = {
  waId: string;
  direction: string;
  type: string;
  text: string | null;
  status: string | null;
  statusAt: string | null;
  errorCode: string | null;
  errorTitle: string | null;
  createdAt: string;
};

type ConversationsResponse = { conversations: Conversation[] };
type MessagesResponse = { phone: string; messages: InboxMessage[] };

const CONVERSATIONS_KEY = ['wa-inbox-conversations'];

function time(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

function preview(row: Conversation): string {
  if (row.lastMessageText) return row.lastMessageText;
  if (row.lastMessageType) return '[' + row.lastMessageType + ' message]';
  return 'No message preview';
}

export function AdminWhatsAppInbox({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const [selectedPhone, setSelectedPhone] = useState('');
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const conversations = useQuery({
    queryKey: CONVERSATIONS_KEY,
    queryFn: () => adminFetch<ConversationsResponse>('/api/admin/whatsapp/conversations'),
    enabled,
    refetchInterval: 15_000,
    retry: false,
  });

  const rows = conversations.data?.conversations ?? [];
  const selected = rows.find((row) => row.phone === selectedPhone) ?? null;

  useEffect(() => {
    if (!selectedPhone && rows.length) setSelectedPhone(rows[0]!.phone);
    if (selectedPhone && rows.length && !rows.some((row) => row.phone === selectedPhone)) {
      setSelectedPhone(rows[0]!.phone);
    }
  }, [rows, selectedPhone]);

  const messages = useQuery({
    queryKey: ['wa-inbox-messages', selectedPhone],
    queryFn: () => adminFetch<MessagesResponse>(
      '/api/admin/whatsapp/conversations/' + encodeURIComponent(selectedPhone) + '/messages',
    ),
    enabled: enabled && Boolean(selectedPhone),
    refetchInterval: 8_000,
    retry: false,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
    if (selectedPhone) void queryClient.invalidateQueries({ queryKey: ['wa-inbox-messages', selectedPhone] });
  };

  const reply = useMutation({
    mutationFn: (text: string) => adminFetch<{ sent: boolean }>(
      '/api/admin/whatsapp/conversations/' + encodeURIComponent(selectedPhone) + '/reply',
      { method: 'POST', body: JSON.stringify({ text }) },
    ),
    onSuccess: () => {
      setDraft('');
      setNotice('Message accepted by WhatsApp.');
      refresh();
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'Could not send the message.'),
  });

  const ownership = useMutation({
    mutationFn: (action: 'takeover' | 'resume') => adminFetch<{ state: string }>(
      '/api/admin/whatsapp/conversations/' + encodeURIComponent(selectedPhone) + '/' + action,
      { method: 'POST', body: JSON.stringify({}) },
    ),
    onSuccess: (result) => {
      setNotice(result.state === 'human' ? 'You now own this conversation. AI replies are paused.' : 'AI replies are resumed for this conversation.');
      refresh();
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'Could not change conversation ownership.'),
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !selected?.replyWindowOpen || reply.isPending) return;
    reply.mutate(text);
  }

  return (
    <section aria-label="WhatsApp inbox">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl text-primary">Guest inbox</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Incoming guest chats, message history and human takeover. Owner access only.</p>
        </div>
        <button type="button" onClick={refresh} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs font-bold text-primary" disabled={conversations.isFetching || messages.isFetching}>
          <RefreshCw size={14} className={conversations.isFetching || messages.isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {notice && (
        <p role="status" className="mt-3 flex items-start justify-between gap-3 rounded-xl bg-secondary p-3 text-[13px] text-primary">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">✕</button>
        </p>
      )}

      <div className="mt-4 grid min-h-[520px] overflow-hidden rounded-2xl border border-border bg-card md:grid-cols-[minmax(230px,0.8fr)_minmax(0,1.7fr)]">
        <aside className="border-b border-border md:border-b-0 md:border-r" aria-label="Conversations">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-[.08em] text-muted-foreground">Conversations · {rows.length}</p>
            <MessageSquare size={15} className="text-muted-foreground" />
          </div>
          {conversations.isLoading && <p className="p-4 text-sm text-muted-foreground">Loading conversations…</p>}
          {conversations.isError && <p className="p-4 text-sm text-destructive">Could not load the inbox. Refresh to try again.</p>}
          {!conversations.isLoading && !rows.length && <p className="p-4 text-sm text-muted-foreground">No incoming WhatsApp messages have been stored yet.</p>}
          <ul className="max-h-[520px] divide-y divide-border overflow-y-auto">
            {rows.map((row) => (
              <li key={row.phone}>
                <button
                  type="button"
                  onClick={() => { setSelectedPhone(row.phone); setDraft(''); setNotice(null); }}
                  className={'w-full px-4 py-3 text-left transition-colors hover:bg-secondary/70 ' + (selectedPhone === row.phone ? 'bg-secondary' : '')}
                  aria-current={selectedPhone === row.phone ? 'true' : undefined}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-primary">{row.phone}</span>
                    <span className="text-[10px] text-muted-foreground">{time(row.lastMessageAt)}</span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">{preview(row)}</span>
                  <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-background px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                    {row.state === 'human' ? <UserRound size={11} /> : <Bot size={11} />}
                    {row.state === 'human' ? 'Human-owned' : 'AI enabled'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="flex min-w-0 flex-col">
          {!selected && <div className="grid flex-1 place-items-center p-8 text-center text-sm text-muted-foreground">Choose a conversation to view its messages.</div>}
          {selected && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <p className="font-semibold text-primary">{selected.phone}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {selected.replyWindowOpen ? '24-hour reply window open' : '24-hour reply window closed'}
                    {' · '}
                    {selected.state === 'human' ? 'AI replies paused' : 'AI may respond'}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-full border border-border px-3 py-2 text-[11px] font-bold text-primary disabled:opacity-50"
                  disabled={ownership.isPending}
                  onClick={() => ownership.mutate(selected.state === 'human' ? 'resume' : 'takeover')}
                >
                  {selected.state === 'human' ? 'Resume AI' : 'Take over'}
                </button>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto bg-background/60 p-4" aria-live="polite">
                {messages.isLoading && <p className="text-sm text-muted-foreground">Loading messages…</p>}
                {messages.isError && <p className="text-sm text-destructive">Could not load message history.</p>}
                {!messages.isLoading && !(messages.data?.messages.length) && (
                  <p className="text-sm text-muted-foreground">No message history is available for this conversation.</p>
                )}
                {(messages.data?.messages ?? []).map((message) => (
                  <div key={message.waId} className={'flex ' + (message.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
                    <div className={'max-w-[88%] rounded-2xl px-3 py-2 ' + (message.direction === 'outbound' ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-foreground')}>
                      <p className="whitespace-pre-wrap break-words text-sm">
                        {message.text || '[' + message.type + ' message — media preview not included in this release]'}
                      </p>
                      <p className={'mt-1 text-[10px] ' + (message.direction === 'outbound' ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                        {time(message.createdAt)}{message.status ? ' · ' + message.status : ''}
                      </p>
                      {message.errorTitle && <p className="mt-1 text-[11px] text-[#A65E45]">{message.errorTitle}</p>}
                    </div>
                  </div>
                ))}
              </div>

              <form onSubmit={submit} className="border-t border-border p-3">
                {!selected.replyWindowOpen && (
                  <p className="mb-2 text-xs text-[#A65E45]">Free-form replies are disabled because the 24-hour window has closed. Use an approved WhatsApp template instead.</p>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    rows={2}
                    maxLength={4096}
                    placeholder={selected.replyWindowOpen ? 'Write a WhatsApp reply…' : 'Template required outside the 24-hour window'}
                    disabled={!selected.replyWindowOpen || reply.isPending}
                    className="min-h-[54px] flex-1 resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                  />
                  <button type="submit" disabled={!selected.replyWindowOpen || !draft.trim() || reply.isPending} className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-4 text-xs font-bold text-primary-foreground disabled:opacity-40">
                    <Send size={14} />
                    {reply.isPending ? 'Sending' : 'Send'}
                  </button>
                </div>
                <p className="mt-1 text-right text-[10px] text-muted-foreground">{draft.length}/4096</p>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
