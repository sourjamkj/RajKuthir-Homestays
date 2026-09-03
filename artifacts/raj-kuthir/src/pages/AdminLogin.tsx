import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Loader2, LockKeyhole } from 'lucide-react';
import { AdminApiError, useAdminSession, useLogin } from '@/lib/admin-api';

export default function AdminLogin() {
  const [, navigate] = useLocation();
  const [password, setPassword] = useState('');
  const session = useAdminSession();
  const login = useLogin();

  // Already signed in (e.g. returning with a valid cookie) — skip the form.
  useEffect(() => {
    if (session.data?.signedIn) navigate('/admin', { replace: true });
  }, [session.data?.signedIn, navigate]);

  const notConfigured = session.data?.configured === false;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password || login.isPending) return;

    login.mutate(password, {
      onSuccess: () => {
        setPassword('');
        navigate('/admin', { replace: true });
      },
    });
  };

  const errorMessage =
    login.error instanceof AdminApiError
      ? login.error.message
      : login.error
        ? 'Could not reach the server. Please try again.'
        : null;

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center justify-between">
          <a
            href="/"
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em] text-primary transition-opacity hover:opacity-70"
            data-testid="link-admin-login-back"
          >
            <ArrowLeft size={14} /> Back to site
          </a>
          <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-accent">
            <LockKeyhole size={13} /> Owner access
          </span>
        </div>

        <div className="rounded-[1.5rem] border border-border bg-card p-7 shadow-sm">
          <h1 className="font-journal text-3xl leading-tight text-primary">
            Owner console
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Sign in to manage your calendar, run a sync, and copy your OTA feed
            links.
          </p>

          {notConfigured ? (
            <div className="mt-6 rounded-xl border border-[#A65E45]/30 bg-[#A65E45]/5 p-4">
              <p className="text-sm font-semibold text-[#A65E45]">
                Admin access is not set up yet.
              </p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Run{' '}
                <code className="rounded bg-background px-1.5 py-0.5 font-mono-ui text-[11px]">
                  node scripts/hash-admin-password.mjs "your password"
                </code>{' '}
                and add the two variables it prints to your host, then redeploy.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-7">
              <label
                htmlFor="admin-password"
                className="text-xs font-bold uppercase tracking-[.08em] text-primary"
              >
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                autoFocus
                className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary"
                data-testid="input-admin-password"
              />

              {errorMessage && (
                <p
                  className="mt-3 text-xs leading-5 text-[#A65E45]"
                  role="alert"
                  data-testid="text-admin-login-error"
                >
                  {errorMessage}
                </p>
              )}

              <button
                type="submit"
                disabled={!password || login.isPending}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3.5 text-xs font-bold uppercase tracking-[.11em] text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="button-admin-login"
              >
                {login.isPending && (
                  <Loader2 size={15} className="animate-spin" />
                )}
                {login.isPending ? 'Signing in' : 'Sign in'}
              </button>
            </form>
          )}
        </div>

        <p className="mt-5 text-center text-[10px] leading-4 text-muted-foreground">
          This page is for the property owner. Guests never need to sign in.
        </p>
      </div>
    </div>
  );
}
