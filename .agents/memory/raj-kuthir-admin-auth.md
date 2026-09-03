---
name: raj-kuthir-admin-auth
description: Owner console auth is self-hosted (scrypt + HMAC cookie, node:crypto only) — never reintroduce Clerk or an external IdP.
---

The `/admin` owner console uses **self-hosted password auth**, intentionally with
`node:crypto` only — no Clerk, no external identity provider. Clerk was removed
2026-09-03 (it needed paid setup, DNS records, and a same-origin proxy).

- `artifacts/api-server/src/lib/admin-auth.ts` — scrypt password check against
  `RAJ_KUTHIR_ADMIN_PASSWORD_HASH`, HMAC-SHA256 signed stateless session cookie
  (`rk_admin`, httpOnly, sameSite lax, secure in prod, 30-day) signed with
  `RAJ_KUTHIR_SESSION_SECRET`. `requireAdmin` guards the routes. In-memory login
  throttle (8 / 15 min).
- `artifacts/api-server/src/routes/admin.ts` — `POST /api/admin/login|logout`,
  `GET /api/admin/me`.
- `scripts/hash-admin-password.mjs` — generates both env vars. The user runs this
  themselves; never generate or handle the password/secret.
- Frontend: `artifacts/raj-kuthir/src/lib/admin-api.ts` (plain `fetch`,
  `credentials: 'include'`), pages `AdminLogin.tsx` (`/admin/login`) and
  `AdminDashboard.tsx` (`/admin`). `AdminCalendar.tsx` also uses raw fetch with
  credentials, not the generated Orval client.
- Admin endpoints (`/api/admin/*`, `/api/calendar/sync-status`) are deliberately
  NOT in `openapi.yaml`.

Public landing page (`Home()` in App.tsx) calls only `useGetPublicCalendar`
(`GET /api/calendar/public`, unauthenticated) — no admin controls, no admin calls.

`GET /api/calendar/feed` stays token-guarded (`RAJ_KUTHIR_CALENDAR_FEED_TOKEN`,
timing-safe compare) for external OTAs — not behind `requireAdmin`.

See [[raj-kuthir-deploy-railway]].
