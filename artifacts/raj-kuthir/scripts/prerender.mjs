/**
 * Writes each public page as HTML into dist/prerender/, after both builds:
 *   vite build                          → dist/public (the browser app)
 *   vite build --ssr src/entry-server   → dist/server (this renderer)
 *
 * The API server puts this HTML inside <div id="root"> for that route and
 * the browser hydrates it. dist/prerender is outside dist/public on purpose:
 * the fragments are never served on their own.
 *
 * A page that fails to render is skipped with a warning rather than failing
 * the deploy: the server then sends the plain shell for it, exactly as before.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist', 'prerender');
const { render, PRERENDER_ROUTES } = await import(pathToFileURL(path.join(root, 'dist', 'server', 'entry-server.js')).href);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let written = 0;
for (const route of PRERENDER_ROUTES) {
  const file = route === '/' ? 'index.html' : `${route.slice(1)}.html`;
  try {
    const html = render(route);
    if (!html.includes('<h1')) throw new Error('rendered without an <h1>');
    writeFileSync(path.join(outDir, file), html);
    written += 1;
    console.log(`prerender: ${route} → ${file} (${Math.round(html.length / 1024)} KB)`);
  } catch (error) {
    console.warn(`prerender: SKIPPED ${route}: ${error instanceof Error ? error.message : error}`);
  }
}
console.log(`prerender: ${written}/${PRERENDER_ROUTES.length} pages`);
