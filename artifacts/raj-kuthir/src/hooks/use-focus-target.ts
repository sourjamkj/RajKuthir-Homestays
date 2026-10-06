import { useEffect } from 'react';

const HIGHLIGHT = ['ring-2', 'ring-accent', 'ring-offset-2', 'ring-offset-background', 'rounded-xl'];
const WAIT_MS = 6000;
const POLL_MS = 200;

/**
 * Deep links from the activity bell: `/admin/guests#stay-<bookingId>` scrolls
 * to that exact row and flashes a ring round it.
 *
 * Rows only exist once their query has loaded, so this polls briefly for the
 * element rather than trusting the first render. If the exact row never
 * appears (filtered out, or since deleted) it falls back to the section that
 * would have held it, so the owner still lands in the right place.
 *
 * Also listens for hashchange: clicking a notification for the page you are
 * already on changes only the hash, with no navigation at all.
 */
export function useFocusTarget(fallbackFor: (targetId: string) => string | null = () => null): void {
  useEffect(() => {
    let poll: number | undefined;
    let unflash: number | undefined;

    const focus = () => {
      window.clearInterval(poll);
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const started = Date.now();

      poll = window.setInterval(() => {
        const exact = document.getElementById(id);
        const gaveUp = Date.now() - started > WAIT_MS;
        if (!exact && !gaveUp) return;
        window.clearInterval(poll);

        const fallbackId = exact ? null : fallbackFor(id);
        const target = exact ?? (fallbackId ? document.getElementById(fallbackId) : null);
        if (!target) return;

        target.scrollIntoView({ behavior: 'smooth', block: exact ? 'center' : 'start' });
        if (exact) {
          target.classList.add(...HIGHLIGHT);
          window.clearTimeout(unflash);
          unflash = window.setTimeout(() => target.classList.remove(...HIGHLIGHT), 3000);
        }
      }, POLL_MS);
    };

    focus();
    window.addEventListener('hashchange', focus);
    return () => {
      window.removeEventListener('hashchange', focus);
      window.clearInterval(poll);
      window.clearTimeout(unflash);
    };
    // fallbackFor is a pure mapping; re-running on identity changes would re-scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
