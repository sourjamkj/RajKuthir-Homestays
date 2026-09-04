import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Wifi,
} from 'lucide-react';

import { adminFetch } from '@/lib/admin-api';

/**
 * Owner-side editor for the arrival pack served at /welcome.
 *
 * The Wi-Fi password lives here rather than in the source so that rotating it
 * is a text box and a Save, not a code change and a deploy — a credential
 * that is awkward to change never gets changed.
 */

const GUEST_INFO_KEY = ['/api/admin/guest-info'];

type GuestContact = { label: string; name: string; phone: string };

type GuestInfo = {
  wifiSsid: string;
  wifiPassword: string;
  arrival: string;
  contacts: GuestContact[];
};

const EMPTY: GuestInfo = { wifiSsid: '', wifiPassword: '', arrival: '', contacts: [] };

const inputClass =
  'mt-2 w-full border-b border-border bg-transparent px-0 py-3 text-sm text-primary outline-none placeholder:text-muted-foreground/50 focus:border-primary';

export default function AdminGuestInfo() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<GuestInfo>(EMPTY);
  const [revealed, setRevealed] = useState(false);
  const [saved, setSaved] = useState(false);

  const info = useQuery({
    queryKey: GUEST_INFO_KEY,
    queryFn: () => adminFetch<GuestInfo>('/api/admin/guest-info'),
    retry: false,
  });

  // Seed the form once the server responds. Deliberately keyed on the fetched
  // object rather than run on mount, so a refetch does not wipe an edit in
  // progress unless the underlying data actually changed.
  useEffect(() => {
    if (info.data) setForm({ ...EMPTY, ...info.data });
  }, [info.data]);

  const save = useMutation({
    mutationFn: (next: GuestInfo) =>
      adminFetch<GuestInfo>('/api/admin/guest-info', {
        method: 'PUT',
        body: JSON.stringify(next),
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(GUEST_INFO_KEY, result);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    },
  });

  const update = <K extends keyof GuestInfo>(key: K, value: GuestInfo[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updateContact = (index: number, key: keyof GuestContact, value: string) => {
    setForm((current) => ({
      ...current,
      contacts: current.contacts.map((contact, position) =>
        position === index ? { ...contact, [key]: value } : contact,
      ),
    }));
  };

  const addContact = () => {
    setForm((current) => ({
      ...current,
      contacts: [...current.contacts, { label: '', name: '', phone: '' }],
    }));
  };

  const removeContact = (index: number) => {
    setForm((current) => ({
      ...current,
      contacts: current.contacts.filter((_, position) => position !== index),
    }));
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="section-shell flex h-[74px] items-center justify-between gap-6">
          <div>
            <p className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-muted-foreground">Owner console</p>
            <h1 className="mt-1 font-journal text-2xl text-primary">Guest arrival pack</h1>
          </div>
          <a
            href="/admin"
            className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-[.09em] text-primary transition-colors hover:border-primary"
            data-testid="link-back-dashboard"
          >
            <ArrowLeft size={13} /> Dashboard
          </a>
        </div>
      </header>

      <main className="section-shell py-12 md:py-16">
        <p className="max-w-[640px] text-sm leading-6 text-muted-foreground">
          This is what a guest sees at <span className="font-mono-ui text-primary">/welcome</span> after entering their
          booking reference. It stops resolving the day after check-out, and it is never part of the public site.
        </p>

        {info.isError && (
          <p className="mt-6 rounded-[1.1rem] border border-accent/40 bg-accent/10 px-5 py-4 text-sm text-primary">
            Could not load the current details. Refresh, or sign in again.
          </p>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(form);
          }}
          className="mt-10 grid gap-6 lg:grid-cols-2"
        >
          <div className="rounded-[1.4rem] border border-border bg-card p-7">
            <Wifi size={22} className="text-accent" strokeWidth={1.4} />
            <p className="mt-5 font-journal text-2xl text-primary">Wi-Fi</p>

            <label className="mt-6 block">
              <span className="eyebrow text-muted-foreground">Network name (SSID)</span>
              <input
                value={form.wifiSsid}
                onChange={(event) => update('wifiSsid', event.target.value)}
                placeholder="MKJ-NETWORK"
                className={inputClass}
                data-testid="input-wifi-ssid"
              />
            </label>

            <label className="mt-6 block">
              <span className="eyebrow text-muted-foreground">Password</span>
              <div className="relative">
                <input
                  type={revealed ? 'text' : 'password'}
                  value={form.wifiPassword}
                  onChange={(event) => update('wifiPassword', event.target.value)}
                  autoComplete="off"
                  placeholder="Type the current Wi-Fi password"
                  className={`${inputClass} pr-11`}
                  data-testid="input-wifi-password"
                />
                <button
                  type="button"
                  onClick={() => setRevealed((open) => !open)}
                  className="absolute right-0 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:text-primary"
                  aria-label={revealed ? 'Hide password' : 'Show password'}
                  data-testid="button-toggle-wifi-password"
                >
                  {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <p className="mt-5 text-xs leading-5 text-muted-foreground">
              Change it here whenever you change it on the router — guests always see the current one, and the
              printed poster becomes the thing that goes out of date instead.
            </p>
          </div>

          <div className="rounded-[1.4rem] border border-border bg-card p-7">
            <p className="font-journal text-2xl text-primary">Finding the house</p>
            <label className="mt-6 block">
              <span className="eyebrow text-muted-foreground">Directions and arrival notes</span>
              <textarea
                rows={11}
                value={form.arrival}
                onChange={(event) => update('arrival', event.target.value)}
                placeholder={'Landmarks, the turn off the main road, the gate, where to park, what to do if you arrive late…'}
                className="mt-2 w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm leading-6 text-primary outline-none placeholder:text-muted-foreground/50 focus:border-primary"
                data-testid="input-arrival-notes"
              />
            </label>
            <p className="mt-3 text-xs text-muted-foreground">Line breaks are kept exactly as you type them.</p>
          </div>

          <div className="rounded-[1.4rem] border border-border bg-card p-7 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-journal text-2xl text-primary">Who to call</p>
                <p className="mt-2 max-w-[560px] text-xs leading-5 text-muted-foreground">
                  Caretaker, electrician, plumber, café, transport, groceries. These are other people's personal
                  numbers — worth telling them they are listed for guests.
                </p>
              </div>
              <button
                type="button"
                onClick={addContact}
                className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-[.09em] text-primary transition-colors hover:border-primary"
                data-testid="button-add-contact"
              >
                <Plus size={13} /> Add contact
              </button>
            </div>

            {form.contacts.length === 0 && (
              <p className="mt-8 text-sm text-muted-foreground">No contacts yet.</p>
            )}

            <div className="mt-6 space-y-4">
              {form.contacts.map((contact, index) => (
                <div
                  key={index}
                  className="grid gap-4 rounded-xl border border-border bg-background p-4 sm:grid-cols-[1fr_1fr_1fr_auto]"
                  data-testid={`row-contact-${index}`}
                >
                  <label className="block">
                    <span className="eyebrow text-muted-foreground">Role</span>
                    <input
                      value={contact.label}
                      onChange={(event) => updateContact(index, 'label', event.target.value)}
                      placeholder="Caretaker"
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="eyebrow text-muted-foreground">Name</span>
                    <input
                      value={contact.name}
                      onChange={(event) => updateContact(index, 'name', event.target.value)}
                      placeholder="Optional"
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="eyebrow text-muted-foreground">Phone</span>
                    <input
                      value={contact.phone}
                      onChange={(event) => updateContact(index, 'phone', event.target.value)}
                      placeholder="+91 …"
                      className={inputClass}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removeContact(index)}
                    className="grid h-10 w-10 shrink-0 place-items-center self-end rounded-full border border-border text-muted-foreground transition-colors hover:border-accent hover:text-accent"
                    aria-label={`Remove ${contact.label || 'contact'}`}
                    data-testid={`button-remove-contact-${index}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>

            <p className="mt-6 text-xs leading-5 text-muted-foreground">
              A row with no phone number is dropped when you save.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 lg:col-span-2">
            <button
              type="submit"
              disabled={save.isPending}
              className="flex items-center gap-2 rounded-full bg-primary px-6 py-4 text-xs font-bold uppercase tracking-[.12em] text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-60"
              data-testid="button-save-guest-info"
            >
              {save.isPending ? 'Saving…' : 'Save arrival pack'}
            </button>

            {saved && (
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em] text-primary" data-testid="status-guest-info-saved">
                <Check size={15} className="text-accent" /> Saved
              </span>
            )}

            {save.isError && (
              <span className="text-xs text-accent">Could not save. Try again.</span>
            )}

            <a
              href="/welcome"
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-xs font-bold uppercase tracking-[.1em] text-muted-foreground transition-colors hover:text-primary"
              data-testid="link-preview-welcome"
            >
              Open /welcome
            </a>
          </div>
        </form>
      </main>
    </div>
  );
}
