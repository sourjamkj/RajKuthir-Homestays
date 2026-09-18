import { useLocation } from 'wouter';
import { ArrowUpRight, LogOut } from 'lucide-react';

import { useLogout } from '@/lib/admin-api';

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
  { href: '/admin/earnings', label: 'Earnings', testId: 'link-admin-earnings' },
  { href: '/admin/rates', label: 'Rates', testId: 'link-admin-rates' },
] as const;

const PILL =
  'rounded-full border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-[.09em] text-primary transition-colors hover:border-primary';

/** The page you are already on: shown, but not a link back to itself. */
const PILL_CURRENT =
  'rounded-full border border-primary bg-primary/5 px-4 py-2 text-[11px] font-bold uppercase tracking-[.09em] text-primary';

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

  // /admin/guests and /admin/guests/ are the same screen; /admin must not
  // match every page that merely starts with it.
  const current = location.replace(/\/+$/, '') || '/admin';

  return (
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
  );
}
