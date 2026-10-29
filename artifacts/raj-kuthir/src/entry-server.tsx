import { renderToString } from 'react-dom/server';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { PRERENDER_ROUTES } from './lib/prerender-routes';

/**
 * Build-time prerender: each public page rendered to HTML, so search engines
 * and link previews get the words, headings, links and images without running
 * JavaScript. Data that loads from the API (rates, availability) renders in
 * its loading state; the browser fills it in after hydrating.
 *
 * Run by scripts/prerender.mjs after `vite build --ssr`. Never shipped to the
 * browser.
 */
export { PRERENDER_ROUTES };

export function render(path: string): string {
  return renderToString(
    <ErrorBoundary>
      <App ssrPath={path} />
    </ErrorBoundary>,
  );
}
