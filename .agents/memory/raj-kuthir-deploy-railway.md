---
name: raj-kuthir-deploy-railway
description: The site is hosted on Railway (not Replit); Express API server serves the built frontend. Deploy setup is currently broken.
---

Raj Kuthir Homestays is deployed on **Railway**, not Replit (`server: railway-hikari`
headers on https://rajkuthirhomestays.casa). The `.replit` / `.replit-artifact/`
files were deleted from the repo on 2026-09-03 — Railway uses the Railpack builder
plus per-service dashboard settings, not those files.

**Railway project "RajKuthir Homestays"** (workspace `sourjamkj's Projects`,
`mkj.sourja@gmail.com`) has 3 services:
- `@workspace/raj-kuthir` — the exposed one. Domain `workspaceraj-kuthir-production.up.railway.app`
  plus the custom domain (`rajkuthirhomestays.casa` apex CNAMEs to `8mqphttu.up.railway.app`).
  Builder Railpack; build `pnpm --filter @workspace/raj-kuthir build`;
  watch paths `/artifacts/raj-kuthir/**`.
- `@workspace/api-server` — **unexposed, no active deployment.** Has env vars set
  (DATABASE_URL, RAJ_KUTHIR_*). Effectively dead.
- Postgres — online, with `postgres-volume`.

**Known problems (as of 2026-09-03):**
- The Railway account is on a **Limited Trial** ("Upgrade to keep your services
  online"). GitHub **auto-deploy is disabled** — the frontend service shows
  "Auto deploy unavailable" and every push since commit `fbb3a3c` is SKIPPED.
  Fixing this needs a plan upgrade (Hobby $5/mo) or a migration.
- The frontend service's **start command is `pnpm --filter @workspace/raj-kuthir dev`**
  — the Vite dev server, not a production static serve. Wrong for prod.
- The intended architecture (per README) is ONE service: the API server builds +
  serves `artifacts/raj-kuthir/dist/public`. The 2-service split is half-finished.

**Correct single-service setup:**
build `pnpm install && pnpm --filter @workspace/raj-kuthir run build && pnpm --filter @workspace/api-server run build`;
start `node artifacts/api-server/dist/index.mjs`; healthcheck `/api/healthz`.

Railway runs `pnpm install --frozen-lockfile` — hard-fails on any mismatch between
manifests and `pnpm-lock.yaml`. Always regenerate + commit the lockfile after a
dependency change. See [[raj-kuthir-public-image-refs]].

**Auth:** Clerk was removed 2026-09-03 (see [[raj-kuthir-admin-auth]]). No more
`CLERK_*` / `VITE_CLERK_*` / `RAJ_KUTHIR_ADMIN_USER_IDS` env vars. New required
vars: `RAJ_KUTHIR_ADMIN_PASSWORD_HASH`, `RAJ_KUTHIR_SESSION_SECRET`
(generate with `node scripts/hash-admin-password.mjs "..."`).

**Custom domains:** apex works; `www` has no DNS record and no Railway custom-domain
entry — both need adding. DNS is Namecheap BasicDNS (`dns1/dns2.registrar-servers.com`),
Clerk CNAMEs (`accounts`, `clerk`, `clk._domainkey`, `clk2._domainkey`) are now
also dead and can be removed.
