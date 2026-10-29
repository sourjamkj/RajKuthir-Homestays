import path from "node:path";

/**
 * Host and caching rules for the site itself. Pure, so they are tested
 * without starting the server.
 */

export const CANONICAL_HOST = "rajkuthirhomestays.casa";

/**
 * www.rajkuthirhomestays.casa (once it has a DNS record and is attached to the
 * Railway service) is sent permanently to the bare domain, path and query kept,
 * so Google only ever sees one copy of each page. Null for every other host.
 */
export function wwwRedirectTarget(hostHeader: string | undefined, originalUrl: string): string | null {
  const host = (hostHeader ?? "").toLowerCase().split(":")[0];
  if (host !== `www.${CANONICAL_HOST}`) return null;
  return `https://${CANONICAL_HOST}${originalUrl.startsWith("/") ? originalUrl : `/${originalUrl}`}`;
}

/**
 * Cache-Control for a file in the built frontend, by its path inside dist.
 * Vite names everything under assets/ by its content hash — a changed file is
 * a new URL — so those are cached for a year. Photos and icons in the public
 * folder keep their names when edited, so a day. HTML is always revalidated.
 */
export function staticCacheControl(relativePath: string): string {
  const file = relativePath.split(path.sep).join("/");
  if (file.startsWith("assets/")) return "public, max-age=31536000, immutable";
  if (file.endsWith(".html")) return "no-cache";
  return "public, max-age=86400";
}

/** The file a route's prerendered HTML is written to (raj-kuthir/scripts/prerender.mjs). */
export function prerenderFileFor(route: string): string {
  return route === "/" ? "index.html" : `${route.replace(/^\/+/, "")}.html`;
}

const EMPTY_ROOT = '<div id="root"></div>';

/**
 * Puts a page's prerendered HTML inside the app's root element, so the words,
 * headings, links and images are in the response itself. Without a fragment,
 * or when the shell has no empty root to fill, the HTML is returned unchanged.
 */
export function withPrerender(html: string, fragment: string | null): string {
  if (!fragment || !html.includes(EMPTY_ROOT)) return html;
  return html.replace(EMPTY_ROOT, () => `<div id="root">${fragment}</div>`);
}
