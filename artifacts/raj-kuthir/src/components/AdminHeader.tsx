import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { AlertTriangle, ArrowUpRight, LogOut } from 'lucide-react';

import { useLogout } from '@/lib/admin-api';
import { AdminActivity } from '@/components/AdminActivity';
import { getWhatsappApp, installWhatsappLinks, setWhatsappApp, type WhatsappApp } from '@/lib/whatsapp-link';

/**
 * The owner console header, on every admin screen.
 *
 * It used to be written out by hand in each page, and the five copies had
 * drifted: only the dashboard carried the full navigation, the other screens
 * offered a single "Calendar" link back, and the arrival-pack page had no way
 * to sign out at all. Getting from Guests to Earnings meant going via the
 * dashboard every time.
 *
 * The eyebrow and title stay per-page — "Nightly rates" tells you where you
 * are in a way that repeating the property name would not — but the navigation
 * and the sign-out are the same everywhere, from one place.
 */

/** Every destination in the console, in the order they appear. */
const LINKS = [
  { href: '/admin', label: 'Calendar', testId: 'link-admin-calendar' },
  { href: '/admin/guest-info', label: 'Arrival pack', testId: 'link-admin-guest-info' },
  { href: '/admin/guests', label: 'Guests', testId: 'link-admin-guests' },
  { href: '/admin/reviews', label: 'Reviews', testId: 'link-admin-reviews' },
  { href: '/admin/earnings', label: 'Earnings', testId: 'link-admin-earnings' },
  { href: '/admin/rates', label: 'Rates', testId: 'link-admin-rates' },
] as const;

const PILL =
  'rounded-full border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-[.09em] text-primary transition-colors hover:border-primary';

/** The page you are already on: shown, but not a link back to itself. */
const PILL_CURRENT =
  'rounded-full border border-primary bg-primary/5 px-4 py-2 text-[11px] font-bold uppercase tracking-[.09em] text-primary';

type InvoiceHealth = { ok: boolean; checkedAt: string; steps: Array<{ name: string; ok: boolean; error?: string }> };

/**
 * A red bar across the console while the hourly invoice self-check is failing
 * (api-server lib/invoice-selfcheck.ts). Nothing shows while PDFs work.
 */
function InvoiceHealthBar() {
  const health = useQuery({
    queryKey: ['/api/health/invoices'],
    // 503 means "failing" and still carries the result, so read the body either way.
    queryFn: async (): Promise<InvoiceHealth | null> => {
      const response = await fetch('/api/health/invoices', { cache: 'no-store' });
      return response.headers.get('content-type')?.includes('json') ? ((await response.json()) as InvoiceHealth) : null;
    },
    refetchInterval: 10 * 60_000,
    staleTime: 5 * 60_000,
  });
  const result = health.data;
  if (!result || result.ok) return null;
  const failing = result.steps.filter((step) => !step.ok);
  return (
    <div role="alert" className="border-b border-[#e3b4a8] bg-[#fbeae5] text-[#7a2e1d]" data-testid="invoice-health-bar">
      <div className="mx-auto flex max-w-[1180px] items-start gap-2 px-5 py-3 text-xs leading-5 md:px-8">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
        <p>
          <strong>Invoice PDFs are failing.</strong> Guest invoices and booking confirmations cannot be made right now
          {failing.length ? ` (${failing.map((step) => `${step.name}: ${step.error ?? 'failed'}`).join('; ')})` : ''}. Send this to Claude to fix.
        </p>
      </div>
    </div>
  );
}

export function AdminHeader({
  eyebrow,
  title,
}: {
  /** The small line above the title, e.g. "Pricing". */
  eyebrow: string;
  /** What this screen is, e.g. "Nightly rates". */
  title: string;
}) {
  const [location, navigate] = useLocation();
  const logout = useLogout();
  const [whatsappApp, setApp] = useState<WhatsappApp>(() => getWhatsappApp());

  // Every WhatsApp link in the console opens the app chosen below.
  useEffect(() => installWhatsappLinks(), []);

  // /admin/guests and /admin/guests/ are the same screen; /admin must not
  // match every page that merely starts with it.
  const current = location.replace(/\/+$/, '') || '/admin';

  return (
    <>
    <InvoiceHealthBar />
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 px-5 py-5 md:px-8">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-accent">
            {eyebrow}
          </p>
          <h1 className="mt-1 font-journal text-2xl text-primary md:text-3xl">
            {title}
          </h1>
        </div>

        <nav className="flex flex-wrap items-center gap-3" aria-label="Owner console">
          {LINKS.map((link) =>
            current === link.href ? (
              <span
                key={link.href}
                aria-current="page"
                className={PILL_CURRENT}
                data-testid={link.testId}
              >
                {link.label}
              </span>
            ) : (
              <a
                key={link.href}
                href={link.href}
                className={PILL}
                data-testid={link.testId}
              >
                {link.label}
              </a>
            ),
          )}

          <a
            href="/"
            className={`${PILL} flex items-center gap-1.5`}
            data-testid="link-view-site"
          >
            View site <ArrowUpRight size={13} />
          </a>

          <label className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.09em] text-primary" title="Which WhatsApp app the console opens on this phone (Android)">
            WhatsApp
            <select
              id="admin-whatsapp-app"
              value={whatsappApp}
              onChange={(event) => {
                const app = event.target.value as WhatsappApp;
                setWhatsappApp(app);
                setApp(app);
              }}
              className="bg-transparent text-[11px] font-bold normal-case tracking-normal text-primary outline-none"
              data-testid="select-whatsapp-app"
            >
              <option value="business">Business</option>
              <option value="personal">Personal</option>
              <option value="default">Phone default</option>
            </select>
          </label>

          <AdminActivity />

          <button
            type="button"
            onClick={() =>
              logout.mutate(undefined, {
                onSuccess: () => navigate('/admin/login', { replace: true }),
              })
            }
            disabled={logout.isPending}
            className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[11px] font-bold uppercase tracking-[.09em] text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            data-testid="button-admin-sign-out"
          >
            <LogOut size={13} /> Sign out
          </button>
        </nav>
      </div>
    </header>
    </>
  );
}
