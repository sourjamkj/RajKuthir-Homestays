# Raj Kuthir Homestays

The website for Raj Kuthir Homestays – Sobuj Potro, a pet-friendly villa in
Bolpur / Shantiniketan, West Bengal. Guest-facing site, an owner admin
calendar, and DB-backed OTA (Airbnb / Booking.com / MakeMyTrip) calendar sync.

## Stack

- pnpm workspaces (monorepo), Node.js 24, TypeScript 5.9
- API: Express 5, self-hosted password auth for the owner console (see Admin access)
- DB: PostgreSQL + Drizzle ORM
- Frontend: React + Vite + Tailwind
- Validation: Zod, API contract in `lib/api-spec/openapi.yaml` (client hooks
  codegen'd via Orval)
- API build: esbuild → single ESM bundle

This repo is plain Node/pnpm — it isn't tied to any specific host. It was
originally scaffolded on Replit; Replit-only files and dependencies have been
removed so it can be installed and deployed anywhere.

## Repo map

```
artifacts/
  api-server/   Express API — src/index.ts is the entrypoint
  raj-kuthir/   the public site + admin UI (Vite/React), builds to dist/public
  mockup-sandbox/  design-only component preview, not part of the deployed app
lib/
  db/           Drizzle schema + Postgres client (@workspace/db)
  api-spec/     OpenAPI source of truth + Orval codegen config
  api-zod/      hand-written + generated Zod schemas (@workspace/api-zod)
  api-client-react/  generated React Query hooks (@workspace/api-client-react)
scripts/        misc workspace scripts (e.g. post-merge hook)
```

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `PORT` | yes | Port the API server listens on |
| `NODE_ENV` | recommended | `production` in prod — makes the session cookie `Secure` |
| `RAJ_KUTHIR_ADMIN_PASSWORD_HASH` | yes | scrypt hash of the owner password — see below |
| `RAJ_KUTHIR_SESSION_SECRET` | yes | Signs the admin session cookie. Changing it signs everyone out |
| `RAJ_KUTHIR_CALENDAR_FEED_TOKEN` | yes | Secret token guarding the outbound `/api/calendar/feed` export |
| `RAJ_KUTHIR_BOOKING_ICAL_URL` | optional | Fallback Booking.com import URL — normally set in the dashboard instead |
| `RAJ_KUTHIR_AIRBNB_ICAL_URL` | optional | Fallback Airbnb import URL — normally set in the dashboard instead |
| `RAJ_KUTHIR_MAKEMYTRIP_ICAL_URL` | optional | Fallback MakeMyTrip import URL — normally set in the dashboard instead |
| `CLIENT_DIST` | no | Overrides where the API server looks for the built frontend (`artifacts/raj-kuthir/dist/public` by default) |

**Inbound** (OTA → this app): the three import URLs are edited from the admin
dashboard and stored in the `app_settings` table, so a feed can be repointed
without a redeploy. The `*_ICAL_URL` variables above are only a fallback for
any source with nothing saved. Resolution order per source: an override passed
to `POST /api/calendar/sync`, then the saved value, then the env var.

**Outbound** (this app → OTA): the three OTAs each get their **own** export URL, generated at
`GET /api/calendar/feed-info` while signed in as admin — each has a different
`?exclude=` so an OTA never receives its own bookings back. Paste each OTA's
own URL into that OTA's "import calendar" field, not the same URL into all
three. The owner console at `/admin` shows all three with copy buttons.

## Admin access

There is one admin (the owner), so the app does not use an external identity
provider. A password is checked against a scrypt hash held in an environment
variable, and a successful sign-in issues an HMAC-signed HttpOnly cookie
(30-day expiry). No session table, so restarts and multiple instances are fine.

Generate both required values:

```bash
node scripts/hash-admin-password.mjs "your chosen password"
```

Paste the two lines it prints into your host's variables panel and redeploy.
The plain password is never stored — if it is lost, generate a new pair.
Rotating `RAJ_KUTHIR_SESSION_SECRET` immediately signs out every session,
which is the fastest way to revoke access.

Routes: `/admin` (dashboard, redirects to login when signed out) and
`/admin/login`. The admin endpoints (`/api/admin/*`, `/api/calendar/sync-status`)
are deliberately not in `openapi.yaml` — they are called with plain `fetch`
from `artifacts/raj-kuthir/src/lib/admin-api.ts` rather than generated hooks.

## Local development

```bash
pnpm install
pnpm --filter @workspace/db run push        # push the Drizzle schema (needs DATABASE_URL)
pnpm --filter @workspace/api-server run dev  # builds + runs the API on $PORT
```

The frontend has its own dev server for iterating on UI (`pnpm --filter
@workspace/raj-kuthir run dev`), but in production the API server serves the
frontend's built static files itself — see Build & deploy below.

Useful workspace-wide commands:
- `pnpm run typecheck` — typecheck every package
- `pnpm run build` — typecheck + build every package

## Build & deploy (any host)

Build order matters: the frontend must be built **before** the API server
starts, because the API server serves it as static files.

```bash
pnpm install
pnpm --filter @workspace/raj-kuthir run build   # → artifacts/raj-kuthir/dist/public
pnpm --filter @workspace/api-server run build   # → artifacts/api-server/dist/index.mjs
node artifacts/api-server/dist/index.mjs        # requires PORT, DATABASE_URL, etc. above
```

Health check endpoint for the API: `GET /api/healthz`.

On most platforms (Railway, Render, Fly.io, a plain VM) this maps to:
build command `pnpm install && pnpm --filter @workspace/raj-kuthir run build && pnpm --filter @workspace/api-server run build`,
start command `node artifacts/api-server/dist/index.mjs`, with the env vars
above set in that platform's secrets/variables panel. The Postgres database
itself can be hosted anywhere (Railway, Neon, Supabase, etc.) — just point
`DATABASE_URL` at it.

`scripts/post-merge.sh` (`pnpm install --frozen-lockfile && pnpm --filter db push`)
is a handy one-liner to run after pulling schema changes; wire it into
whatever CI/deploy step fits your host (e.g. a GitHub Actions step, or your
platform's build hook) — it's no longer triggered automatically by anything.

## Where things live

- Calendar/OTA sync logic: `artifacts/api-server/src/lib/calendar-*.ts` and
  `artifacts/api-server/src/routes/calendar.ts` — see the `source` field on
  `calendar_events` (`manual` / `direct` / `bookingCom` / `airbnb` /
  `makeMyTrip`) for how imports, manual blocks, and exports interact.
- DB schema source of truth: `lib/db/src/schema/`
- API contract source of truth: `lib/api-spec/openapi.yaml`

## Gotchas

- OpenAPI codegen can emit Zod helpers newer than the installed Zod version
  supports — after running codegen, typecheck immediately and keep hints
  conservative (see `.agents/memory/api-codegen-zod-compat.md`).
- Avoid bare root-relative URLs (e.g. `/`) in HTML metadata Vite processes as
  assets (canonical links especially) — Vite can resolve it against the
  project root and fail the production build with `EISDIR` (see
  `.agents/memory/vite-html-root-url.md`).
