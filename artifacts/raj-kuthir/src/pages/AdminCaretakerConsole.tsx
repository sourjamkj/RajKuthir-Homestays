import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, MessageCircle, Pencil } from 'lucide-react';
import {
  AdminApiError,
  createCaretakerMessage,
  getCaretakerConsole,
  markCaretakerMessageSent,
  patchSettings,
  previewCaretakerMessage,
  type CaretakerDraft,
  type CaretakerMessageKind,
  type CaretakerTemplate,
} from '@workspace/admin-client';

import { AdminHeader } from '@/components/AdminHeader';

/**
 * Caretaker console: messages from the owner to the caretaker (salary
 * credited, a festival bonus, a day off, a notice about the house), written
 * the same professional way every time and sent from the owner's own
 * WhatsApp. The phone app has the same screen, on the same endpoints.
 *
 * Nothing sends by itself: "Open in WhatsApp" opens the owner's WhatsApp on
 * her chat with the message typed; the owner presses send, then "Mark sent".
 * No amounts are ever written into these messages.
 */

const CONSOLE_KEY = ['/api/admin/caretaker/messages'];

const field =
  'mt-2 w-full border-b border-border bg-transparent px-0 py-2.5 text-sm text-primary placeholder:text-muted-foreground/60 focus:border-primary';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso));

function defaultsFor(template: CaretakerTemplate, today: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const spec of template.fields) {
    if (spec.type === 'date') fields[spec.key] = today;
    else if (spec.type === 'month') {
      // Salary is usually paid at the start of a month for the month before.
      const [y, m] = today.split('-').map(Number);
      const prev = new Date(Date.UTC(y!, m! - 2, 1));
      fields[spec.key] = Number(today.slice(8, 10)) <= 10 ? prev.toISOString().slice(0, 7) : today.slice(0, 7);
    } else if (spec.type === 'choice') fields[spec.key] = spec.options?.[0] ?? '';
    else fields[spec.key] = '';
  }
  return fields;
}

export default function AdminCaretakerConsole() {
  const queryClient = useQueryClient();
  const data = useQuery({ queryKey: CONSOLE_KEY, queryFn: getCaretakerConsole, retry: false });

  const [kind, setKind] = useState<CaretakerMessageKind>('salary_credited');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string>('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ id: string; url: string } | null>(null);

  const template = useMemo(() => data.data?.templates.find((t) => t.kind === kind) ?? null, [data.data, kind]);

  // New template: fresh defaults (today's date, last month's salary early in a month).
  useEffect(() => {
    if (template && data.data) setFields(defaultsFor(template, data.data.today));
    setOpened(null);
  }, [template, data.data?.today]); // eslint-disable-line react-hooks/exhaustive-deps

  // The preview is written by the server, so it is exactly what will be sent.
  useEffect(() => {
    if (!template) return;
    const draft: CaretakerDraft = { kind, fields };
    const timer = window.setTimeout(() => {
      previewCaretakerMessage(draft)
        .then((r) => {
          setPreview(r.body);
          setPreviewError(null);
        })
        .catch((e: unknown) => setPreviewError(e instanceof AdminApiError ? e.message : 'Could not write the preview.'));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [kind, fields, template, data.data?.caretaker.name, data.data?.signature]);

  const create = useMutation({
    mutationFn: () => createCaretakerMessage({ kind, fields }),
    onSuccess: (result) => {
      setOpened({ id: result.message.id, url: result.whatsappUrl });
      window.open(result.whatsappUrl, '_blank', 'noopener');
      void queryClient.invalidateQueries({ queryKey: CONSOLE_KEY });
    },
  });

  const markSent = useMutation({
    mutationFn: (id: string) => markCaretakerMessageSent(id),
    onSuccess: () => {
      setOpened(null);
      void queryClient.invalidateQueries({ queryKey: CONSOLE_KEY });
    },
  });

  const [editingPeople, setEditingPeople] = useState(false);
  const [people, setPeople] = useState({ caretakerName: '', ownerSignature: '' });
  useEffect(() => {
    if (data.data) setPeople({ caretakerName: data.data.caretaker.name ?? '', ownerSignature: data.data.signature });
  }, [data.data]);
  const savePeople = useMutation({
    mutationFn: () => patchSettings({ caretakerName: people.caretakerName || null, ownerSignature: people.ownerSignature || null }),
    onSuccess: () => {
      setEditingPeople(false);
      void queryClient.invalidateQueries({ queryKey: CONSOLE_KEY });
    },
  });

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <AdminHeader eyebrow="Owner console" title="Caretaker" />

      <main className="section-shell grid gap-8 py-10 md:py-14 lg:grid-cols-[1.05fr_.95fr]">
        {data.isError && (
          <p className="rounded-xl border border-terracotta/40 bg-terracotta/5 px-5 py-4 text-sm text-terracotta lg:col-span-2">
            Could not load the caretaker console. Refresh, or sign in again.
          </p>
        )}

        <section className="space-y-6" aria-labelledby="compose-title">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[13px] font-medium text-muted-foreground">Sending to</p>
                <p className="mt-1 text-base font-semibold text-primary" data-testid="text-caretaker-name">
                  {data.data?.caretaker.name ?? 'Caretaker (add her name)'} · <span className="tabular-nums">{data.data?.caretaker.phone ?? '…'}</span>
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground">Signed: {data.data?.signature ?? '…'}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingPeople((v) => !v)}
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[13px] font-medium text-primary hover:border-primary"
                data-testid="button-edit-people"
              >
                <Pencil size={14} /> Edit
              </button>
            </div>
            {editingPeople && (
              <form
                className="mt-4 grid gap-4 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  savePeople.mutate();
                }}
              >
                <label className="block">
                  <span className="eyebrow text-muted-foreground">Her name</span>
                  <input id="caretaker-name" value={people.caretakerName} onChange={(e) => setPeople({ ...people, caretakerName: e.target.value })} className={field} placeholder="e.g. Rina" data-testid="input-caretaker-name" />
                </label>
                <label className="block">
                  <span className="eyebrow text-muted-foreground">Sign messages as</span>
                  <input id="owner-signature" value={people.ownerSignature} onChange={(e) => setPeople({ ...people, ownerSignature: e.target.value })} className={field} data-testid="input-owner-signature" />
                </label>
                <p className="text-[13px] text-muted-foreground sm:col-span-2">
                  Her WhatsApp number is changed in Settings (it needs your password).
                </p>
                {savePeople.error && <p className="text-[13px] text-terracotta sm:col-span-2" role="alert">{(savePeople.error as Error).message}</p>}
                <button type="submit" disabled={savePeople.isPending} className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50 sm:col-span-2 sm:justify-self-start">
                  Save
                </button>
              </form>
            )}
          </div>

          <div>
            <h2 id="compose-title" className="font-journal text-3xl text-primary">New message</h2>
            <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="What the message is about">
              {data.data?.templates.map((t) => (
                <button
                  key={t.kind}
                  type="button"
                  role="radio"
                  aria-checked={kind === t.kind}
                  onClick={() => setKind(t.kind)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${kind === t.kind ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-primary hover:border-primary'}`}
                  data-testid={`chip-caretaker-${t.kind}`}
                >
                  {t.title}
                </button>
              ))}
            </div>
            {template && <p className="mt-3 text-[13px] text-muted-foreground">{template.description}</p>}
          </div>

          {template && (
            <form
              className="grid gap-5 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              {template.fields.map((spec) => (
                <label key={spec.key} className={`block ${spec.type === 'longtext' || spec.type === 'text' ? 'sm:col-span-2' : ''}`}>
                  <span className="eyebrow text-muted-foreground">
                    {spec.label}
                    {spec.required ? ' *' : ''}
                  </span>
                  {spec.type === 'choice' ? (
                    <select id={`ct-${spec.key}`} value={fields[spec.key] ?? ''} onChange={(e) => setFields({ ...fields, [spec.key]: e.target.value })} className={field}>
                      {spec.options?.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : spec.type === 'longtext' ? (
                    <textarea id={`ct-${spec.key}`} rows={5} maxLength={spec.max} value={fields[spec.key] ?? ''} onChange={(e) => setFields({ ...fields, [spec.key]: e.target.value })} className={`${field} resize-y`} />
                  ) : (
                    <input
                      id={`ct-${spec.key}`}
                      type={spec.type === 'month' ? 'month' : spec.type === 'date' ? 'date' : 'text'}
                      maxLength={spec.max}
                      placeholder={spec.hint}
                      value={fields[spec.key] ?? ''}
                      onChange={(e) => setFields({ ...fields, [spec.key]: e.target.value })}
                      className={field}
                      data-testid={`input-ct-${spec.key}`}
                    />
                  )}
                </label>
              ))}
              {(create.error || previewError) && (
                <p className="text-[13px] text-terracotta sm:col-span-2" role="alert">
                  {create.error ? (create.error as Error).message : previewError}
                </p>
              )}
              <div className="flex flex-wrap gap-3 sm:col-span-2">
                <button
                  type="submit"
                  disabled={create.isPending || Boolean(previewError)}
                  className="flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  data-testid="button-caretaker-open-whatsapp"
                >
                  <MessageCircle size={16} /> Open in WhatsApp
                </button>
                {opened && (
                  <>
                    <button
                      type="button"
                      onClick={() => markSent.mutate(opened.id)}
                      className="flex items-center gap-2 rounded-full border border-primary/25 px-5 py-3 text-sm font-semibold text-primary"
                      data-testid="button-caretaker-mark-sent"
                    >
                      <Check size={16} /> I sent it
                    </button>
                    <a href={opened.url} target="_blank" rel="noreferrer" className="self-center text-[13px] text-primary underline decoration-accent underline-offset-2">
                      WhatsApp did not open?
                    </a>
                  </>
                )}
              </div>
            </form>
          )}
        </section>

        <section className="space-y-6">
          <div>
            <p className="text-[13px] font-medium text-muted-foreground">Preview: what she will see</p>
            <div className="mt-3 rounded-2xl bg-[#e7ddd1] p-4" data-testid="caretaker-preview">
              <div className="ml-auto max-w-[420px] whitespace-pre-wrap rounded-xl rounded-tr-sm bg-[#d9fdd3] px-4 py-3 text-[14px] leading-6 text-[#111b21] shadow-sm">
                {renderWhatsappBold(preview || '…')}
              </div>
            </div>
          </div>

          <div>
            <h2 className="font-journal text-2xl text-primary">Sent before</h2>
            <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card" data-testid="list-caretaker-history">
              {(data.data?.history ?? []).length === 0 && <li className="p-4 text-[13px] text-muted-foreground">Nothing yet.</li>}
              {data.data?.history.map((m) => (
                <li key={m.id} className="p-4">
                  <details>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-primary">{data.data?.templates.find((t) => t.kind === m.kind)?.title ?? m.kind}</span>
                      <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                        {when(m.createdAt)}
                        {m.sentAt ? (
                          <span className="rounded-full bg-secondary px-2 py-0.5 text-primary">Sent</span>
                        ) : (
                          <button type="button" onClick={(e) => { e.preventDefault(); markSent.mutate(m.id); }} className="rounded-full border border-border px-2 py-0.5 text-primary hover:border-primary">
                            Mark sent
                          </button>
                        )}
                      </span>
                    </summary>
                    <p className="mt-3 whitespace-pre-wrap text-[13px] leading-5 text-muted-foreground">{m.body}</p>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}

/** *bold* the way WhatsApp shows it, for the preview bubble. */
function renderWhatsappBold(text: string) {
  return text.split(/(\*[^*\n]+\*)/g).map((part, i) =>
    /^\*[^*\n]+\*$/.test(part) ? <strong key={i}>{part.slice(1, -1)}</strong> : <span key={i}>{part}</span>,
  );
}
