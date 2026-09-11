import { useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Check,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react';

import {
  formatDateTime,
  useAddMailbox,
  useDeleteMailbox,
  useMailAccounts,
  useRewindMailbox,
  useRunMailSync,
  useUpdateMailbox,
  type MailAccount,
} from '@/lib/admin-api';

/**
 * Mailboxes the server reads booking emails from.
 *
 * This sits with the calendar links rather than on a page of its own because
 * it is the same job: getting bookings in. Some channels publish a calendar
 * feed, others only send an email, and the owner should not have to know
 * which is which to find the setting.
 *
 * The password is write-only throughout. It goes in once, the server seals it,
 * and nothing — no endpoint, no hook, no field here — can read it back. The
 * password box on a saved mailbox therefore means "replace it", never "edit
 * it", and leaving it empty leaves the stored one alone.
 */

const PROVIDERS = [
  { id: 'gmail', name: 'Gmail', host: 'imap.gmail.com', port: 993 },
  { id: 'yahoo', name: 'Yahoo', host: 'imap.mail.yahoo.com', port: 993 },
  { id: 'other', name: 'Other', host: '', port: 993 },
] as const;

const INPUT =
  'min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] text-foreground outline-none transition-colors focus:border-primary';
const PRIMARY_BUTTON =
  'flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-[11px] font-bold uppercase tracking-[.07em] text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40';
const QUIET_BUTTON =
  'flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-bold uppercase tracking-[.07em] text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40';

function errorText(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}

export function AdminMailboxes() {
  const accounts = useMailAccounts(true);
  const runSync = useRunMailSync();

  const data = accounts.data;
  const rows = data?.accounts ?? [];
  const syncError = errorText(runSync.error);
  const lastResult = runSync.data?.result ?? data?.lastSync ?? null;

  return (
    <div className="flex flex-col gap-4">
      {/*
        The key banner comes first and cannot be dismissed. Without a usable
        key nothing below does anything, and a screen that lets someone add a
        mailbox that will silently never run is worse than one that refuses.
      */}
      {data && !data.encryptionConfigured && (
        <div
          className="rounded-2xl border border-[#A65E45]/40 bg-[#A65E45]/5 p-5"
          role="alert"
          data-testid="banner-mail-key-problem"
        >
          <p className="flex items-center gap-2 text-sm font-bold text-[#A65E45]">
            <AlertCircle size={15} /> Mailboxes cannot run yet
          </p>
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
            {data.encryptionProblem ??
              'The mailbox encryption key is not usable.'}
          </p>
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
            Mailbox passwords are encrypted before they are stored, so a
            working <span className="font-mono-ui">MAIL_ENCRYPTION_KEY</span>{' '}
            has to be set on the server before a mailbox can be added.
          </p>
        </div>
      )}

      {accounts.isLoading && (
        <p className="text-sm text-muted-foreground">Loading mailboxes…</p>
      )}

      {rows.map((account) => (
        <MailboxRow key={account.id} account={account} />
      ))}

      {data && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            No mailbox connected yet. Add one below and booking emails will be
            read automatically every two hours.
          </p>
        </div>
      )}

      <AddMailboxForm disabled={data ? !data.encryptionConfigured : true} />

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-primary">Check now</p>
            <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
              Mail is read every two hours on its own. This reads it
              immediately.
            </p>
          </div>
          <button
            type="button"
            onClick={() => runSync.mutate()}
            disabled={runSync.isPending || rows.length === 0}
            className={PRIMARY_BUTTON}
            data-testid="button-mail-sync-now"
          >
            {runSync.isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            {runSync.isPending ? 'Checking' : 'Check now'}
          </button>
        </div>

        {syncError && (
          <p className="mt-3 text-xs text-[#A65E45]" role="alert">
            {syncError}
          </p>
        )}

        {lastResult && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground">
              Last check · {formatDateTime(lastResult.syncedAt)}
            </p>
            {lastResult.accounts.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted-foreground">
                No mailbox was checked.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {lastResult.accounts.map((result) => (
                  <li
                    key={result.accountId}
                    className="text-[13px] leading-6 text-muted-foreground"
                  >
                    <span className="font-bold text-primary">
                      {result.label}
                    </span>{' '}
                    — {result.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/*
        Said plainly, because the alternative is someone connecting a mailbox,
        seeing nothing import, and assuming it is broken when it is working
        exactly as built.
      */}
      <p className="text-[13px] leading-6 text-muted-foreground">
        Only MakeMyTrip and Goibibo vouchers are read from email at the moment.
        Airbnb and Booking.com bookings already arrive through their calendar
        links above, so their emails are passed over on purpose. Other mail in
        the folder is ignored and never stored.
      </p>
    </div>
  );
}

function MailboxRow({ account }: { account: MailAccount }) {
  const update = useUpdateMailbox();
  const remove = useDeleteMailbox();
  const rewind = useRewindMailbox();

  const [password, setPassword] = useState('');
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const busy = update.isPending || remove.isPending || rewind.isPending;
  const message =
    errorText(update.error) ?? errorText(remove.error) ?? errorText(rewind.error);

  return (
    <div
      className="rounded-2xl border border-border bg-card p-5"
      data-testid={`row-mailbox-${account.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-primary">{account.label}</p>
          <p className="mt-1 break-all font-mono-ui text-[11px] text-muted-foreground">
            {account.username} · {account.host}:{account.port} ·{' '}
            {account.folder}
          </p>
        </div>

        <label className="flex shrink-0 items-center gap-2 text-[10px] font-bold uppercase tracking-[.07em] text-muted-foreground">
          <input
            type="checkbox"
            checked={account.enabled}
            disabled={busy}
            onChange={(event) =>
              update.mutate({ id: account.id, enabled: event.target.checked })
            }
            className="h-4 w-4 accent-[#4b5340]"
            data-testid={`toggle-mailbox-${account.id}`}
          />
          {account.enabled ? 'On' : 'Paused'}
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>Last checked {formatDateTime(account.lastCheckedAt)}</span>
        {account.lastError ? (
          <span className="flex items-center gap-1 text-[#A65E45]">
            <AlertCircle size={11} /> {account.lastError}
          </span>
        ) : account.lastCheckedAt ? (
          <span className="flex items-center gap-1 text-[#4b5340]">
            <Check size={11} /> Last check was clean
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="password"
          value={password}
          autoComplete="new-password"
          placeholder="Replace the app password…"
          onChange={(event) => setPassword(event.target.value)}
          className={INPUT}
          data-testid={`input-mailbox-password-${account.id}`}
        />
        <button
          type="button"
          disabled={!password.trim() || busy}
          onClick={() =>
            update.mutate(
              { id: account.id, password: password.trim() },
              { onSuccess: () => setPassword('') },
            )
          }
          className={PRIMARY_BUTTON}
          data-testid={`button-mailbox-password-${account.id}`}
        >
          {update.isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : null}
          Replace
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => rewind.mutate(account.id)}
          className={QUIET_BUTTON}
          title="Read this folder again from the beginning"
          data-testid={`button-mailbox-rewind-${account.id}`}
        >
          <RotateCcw size={12} /> Read from the start
        </button>

        {confirmingRemove ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => remove.mutate(account.id)}
              className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#A65E45] px-3 py-2 text-[11px] font-bold uppercase tracking-[.07em] text-[#A65E45] transition-colors hover:bg-[#A65E45]/10 disabled:cursor-not-allowed disabled:opacity-40"
              data-testid={`button-mailbox-remove-confirm-${account.id}`}
            >
              {remove.isPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Trash2 size={12} />
              )}
              Remove for good
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              className={QUIET_BUTTON}
            >
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmingRemove(true)}
            className={QUIET_BUTTON}
            data-testid={`button-mailbox-remove-${account.id}`}
          >
            <Trash2 size={12} /> Remove
          </button>
        )}
      </div>

      {message && (
        <p className="mt-2 text-xs text-[#A65E45]" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}

function AddMailboxForm({ disabled }: { disabled: boolean }) {
  const add = useAddMailbox();

  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]['id']>(
    'gmail',
  );
  const [label, setLabel] = useState('');
  // Explicitly a string: PROVIDERS is `as const`, so the initial value would
  // otherwise narrow this to the Gmail host alone and reject both the Yahoo
  // preset and anything typed by hand.
  const [host, setHost] = useState<string>(PROVIDERS[0].host);
  const [port, setPort] = useState(String(PROVIDERS[0].port));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [folder, setFolder] = useState('INBOX');

  const chosen = PROVIDERS.find((entry) => entry.id === provider)!;
  const ready =
    label.trim() && host.trim() && username.trim() && password.trim();

  const submit = () => {
    if (!ready || add.isPending || disabled) return;
    add.mutate(
      {
        label: label.trim(),
        host: host.trim(),
        port: Number(port) || 993,
        username: username.trim(),
        password: password.trim(),
        folder: folder.trim() || 'INBOX',
        secure: true,
      },
      {
        onSuccess: () => {
          setLabel('');
          setUsername('');
          setPassword('');
        },
      },
    );
  };

  const message = errorText(add.error);

  return (
    <div
      className="rounded-2xl border border-border bg-card p-5"
      data-testid="form-add-mailbox"
    >
      <p className="flex items-center gap-2 text-sm font-bold text-primary">
        <Mail size={15} /> Connect a mailbox
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {PROVIDERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => {
              setProvider(entry.id);
              setHost(entry.host);
              setPort(String(entry.port));
            }}
            className={`rounded-lg border px-3 py-2 text-[11px] font-bold uppercase tracking-[.07em] transition-colors ${
              provider === entry.id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:border-primary hover:text-primary'
            }`}
            data-testid={`button-provider-${entry.id}`}
          >
            {entry.name}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Name it" htmlFor="mailbox-label">
          <input
            id="mailbox-label"
            value={label}
            placeholder="Bookings inbox"
            onChange={(event) => setLabel(event.target.value)}
            className={INPUT}
            data-testid="input-mailbox-label"
          />
        </Field>

        <Field label="Email address" htmlFor="mailbox-username">
          <input
            id="mailbox-username"
            type="email"
            autoComplete="username"
            value={username}
            placeholder="you@gmail.com"
            onChange={(event) => setUsername(event.target.value)}
            className={INPUT}
            data-testid="input-mailbox-username"
          />
        </Field>

        <Field label="App password" htmlFor="mailbox-password">
          <input
            id="mailbox-password"
            type="password"
            autoComplete="new-password"
            value={password}
            placeholder="16-character app password"
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
            className={INPUT}
            data-testid="input-mailbox-password"
          />
        </Field>

        <Field label="Folder" htmlFor="mailbox-folder">
          <input
            id="mailbox-folder"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            className={INPUT}
            data-testid="input-mailbox-folder"
          />
        </Field>

        {chosen.id === 'other' && (
          <>
            <Field label="IMAP server" htmlFor="mailbox-host">
              <input
                id="mailbox-host"
                value={host}
                placeholder="imap.example.com"
                onChange={(event) => setHost(event.target.value)}
                className={INPUT}
                data-testid="input-mailbox-host"
              />
            </Field>

            <Field label="Port" htmlFor="mailbox-port">
              <input
                id="mailbox-port"
                inputMode="numeric"
                value={port}
                onChange={(event) => setPort(event.target.value)}
                className={INPUT}
                data-testid="input-mailbox-port"
              />
            </Field>
          </>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[460px] text-[13px] leading-6 text-muted-foreground">
          Use an app password, not the password you sign in with. Gmail and
          Yahoo both issue one from their account security settings once
          two-step verification is on, and it can be revoked there without
          touching your account.
        </p>
        <button
          type="button"
          onClick={submit}
          disabled={!ready || add.isPending || disabled}
          className={PRIMARY_BUTTON}
          data-testid="button-add-mailbox"
        >
          {add.isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Plus size={13} />
          )}
          {add.isPending ? 'Connecting' : 'Connect'}
        </button>
      </div>

      {message && (
        <p className="mt-3 text-xs text-[#A65E45]" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
