import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { adminFetch } from '@/lib/admin-api';
import type { AutoSendKind, SettingsView } from '@workspace/admin-client';

/**
 * Which booking messages go to guests by themselves. Each is a fixed,
 * Meta-approved template filled from the booking, so it needs no review;
 * everything else (reviews, offers, anything AI-written) still waits for the
 * owner. Changing this asks for the admin password.
 */
const SETTINGS_KEY = ['/api/admin/settings'];

export function AdminAutoSend() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => adminFetch<SettingsView>('/api/admin/settings') });
  const saved = settings.data?.whatsapp.autoSend.value;
  const [picked, setPicked] = useState<AutoSendKind[]>([]);
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (saved) setPicked(saved);
  }, [saved?.join(',')]);

  const save = useMutation({
    mutationFn: () =>
      adminFetch('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ whatsappAutoSend: picked, confirmPassword: password }),
      }),
    onSuccess: () => {
      setPassword('');
      void queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });

  if (!settings.data) return null;
  const w = settings.data.whatsapp;
  const changed = (saved ?? []).join(',') !== picked.join(',');
  const toggle = (kind: AutoSendKind) =>
    setPicked((now) => w.autoSendOptions.map((o) => o.kind).filter((k) => (k === kind ? !now.includes(k) : now.includes(k))));

  return (
    <div className="rounded-2xl border border-border bg-card p-5 md:p-6" data-testid="card-auto-send">
      <ul className="grid gap-3">
        {w.autoSendOptions.map((option) => (
          <li key={option.kind}>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                id={`auto-send-${option.kind}`}
                checked={picked.includes(option.kind)}
                onChange={() => toggle(option.kind)}
                className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
                data-testid={`checkbox-auto-send-${option.kind}`}
              />
              <span>
                <span className="block text-sm font-bold text-primary">{option.label}</span>
                <span className="block text-[13px] leading-5 text-muted-foreground">{option.description}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[12px] leading-5 text-muted-foreground">
        Ticked messages go out by themselves once WhatsApp is on the Business API. Unticked ones wait for you as drafts. Review requests, offers and
        anything not from an approved template always wait. No message goes out between 9 pm and 8 am.
        {w.mode.value !== 'api' && ' WhatsApp is in manual mode right now, so every message waits for you to send it from your phone.'}
      </p>
      {changed && (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">Admin password</span>
            <input
              type="password"
              id="auto-send-password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>
          <button type="submit" disabled={save.isPending} className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[11px] font-bold uppercase tracking-[.08em] text-primary-foreground disabled:opacity-50" data-testid="button-auto-send-save">
            {save.isPending && <Loader2 size={13} className="animate-spin" />} Save
          </button>
          <button type="button" onClick={() => setPicked(saved ?? [])} className="text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground underline underline-offset-2">
            Undo
          </button>
          {save.isError && (
            <p className="w-full text-xs text-terracotta" role="alert">
              {save.error instanceof Error ? save.error.message : 'Could not save.'}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
