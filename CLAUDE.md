# CLAUDE.md — Raj Kuthir Homestays – Sobuj Potro

The booking site, owner console, owner app and guest automation for one homestay in Santiniketan, run by one owner (Sourja). Read this first; it overrides habits.

## How I work (non-negotiable)

1. **One PR at a time.** Branch from `main`. Never push to `main`.
2. **Merge only on my explicit words: "merge #N".** Approval of a plan, a draft or a description is not approval to merge.
3. **No production deploy without my approval.** Railway deploys `main` automatically, so merging *is* deploying.
4. After each merge: wait for the Railway deploy to finish, then check `https://rajkuthirhomestays.casa/api/healthz` returns `{"status":"ok"}`. One change at a time.
5. Never switch on a new automatic guest message, payment flow or outward action without my explicit words. New message kinds ship **unticked**.
6. When I'm away, take the most reasonable reading, say which one you took at the top, and stop before anything irreversible.

## Secrets (hard rules)

- Read variable **names** only. Never print, log, echo, commit or paste a secret value, and never ask me to paste one into chat.
- You may set a Railway variable yourself only if its value is **not secret** (template name, true/false switch, public ID). For anything secret, give me exact Railway dashboard steps and I enter it.
- No payment-gateway keys of any kind until I say KYC is approved. Never type card numbers into the live site.
- Never enter passwords. Never bypass bot detection or CAPTCHAs. No logged-in scraping of OTA extranets.

## Coding standard: lazy senior dev

Solve the whole problem with the least new code.

- **Smallest complete change.** Before writing, list every place the change must reach (callers, tests, fixtures, schema, client types, owner-app labels) and change all of them. Nothing beyond that.
- **Reuse first:** existing helper → stdlib/platform → installed dependency → a few new lines. Never add a dependency for a few lines.
- No abstraction, option, config or "for later" code nobody asked for. Deletion beats addition. Keep the existing structure.
- Bug fix: grep every caller, fix the root cause once in shared code.
- Comment only the *why*, in one line. A known limit gets `// shortcut: <the limit>, <when to upgrade>`.
- New non-trivial logic (branch, loop, parser, money, dates, security) gets one small `node:test` test.
- Never cut: validation at trust boundaries, error handling that prevents data loss, security, accessibility.

## Repo map

pnpm monorepo (pnpm only), TypeScript, Express + React/Vite + Postgres/Drizzle, hosted on Railway.

| Path | What |
|---|---|
| `artifacts/api-server/src/routes/` | Express routes (thin) |
| `artifacts/api-server/src/lib/*-rules.ts` | **Pure** logic, no DB/network; tested in `*-rules.test.ts` beside it |
| `artifacts/api-server/src/lib/*-repo.ts` | DB access |
| `artifacts/api-server/src/lib/*-cron.ts` | Schedulers (notifications every 15 min, calendar sync, mail, reviews, book & pay) |
| `artifacts/raj-kuthir/` | Public site + web owner console (`/admin`), prerendered |
| `artifacts/owner-app/` | Native Android owner app; mirrors the web console |
| `lib/db/src/schema/` | Drizzle schema (source of truth for types) |
| `lib/admin-client/` | Typed client shared by console and owner app |
| `services/hermes/` | Hermes WhatsApp guest agent (own Railway service; the one approved exception to "no separate service"). Guest tools only via `/mcp/guest` — see its README |

**Schema changes:** edit `lib/db/src/schema/*` *and* add idempotent SQL to the matching `ensure*Tables()` / `*_MIGRATION_SQL` run at startup (`CREATE … IF NOT EXISTS`, `ALTER TYPE … ADD VALUE IF NOT EXISTS`). Never destructive migrations. A new enum value also goes in `lib/admin-client` unions and the owner-app labels.

## Checks before every PR

```bash
pnpm run typecheck                        # whole workspace, must exit 0
cd artifacts/api-server && pnpm test      # all tests must pass
```

GitHub runs both on every PR (`.github/workflows/ci.yml`); a red CI run is never "waiting on review". Report "typecheck passes, N tests pass" in the PR body, plus anything you could not verify. For SQL that matters, run it against a local Postgres with the schema.

PR body: Why → What → Checks → what I must do before/after merging. End with what was skipped or risky.

## Guest messaging (WhatsApp Cloud API)

- Outbox: `whatsapp_messages`, one row per (booking, kind); `notifications.ts` schedules and drains it; `whatsapp-templates.ts` maps kinds → Meta templates; auto-send kinds are ticked in the console (`owner-settings-rules.ts`), unticked kinds stay drafts.
- A template must be **approved by Meta** before code depends on it. Prefer an env switch (e.g. `WHATSAPP_CHECKOUT_TEMPLATE`) so the old approved template keeps working until then.
- Guest DND: **11 pm – 8 am IST**, except the payment confirmation (immediate). Caretaker messages: no quiet hours.
- Arrival messages and the confirmation PDF wait for **verified guest ID**. ID-upload messages keep the disclaimer: failure to verify may mean check-in is denied without refund.
- Every guest notice states the **₹2,500 refundable security deposit**. Check-in 12 noon, check-out 11 am.
- No marketing to OTA guests; marketing only with consent, never to opted-out numbers. Never put the Wi-Fi password in template text (it lives in the PDF).
- Copy uses only verified facts, warm and professional, signed "Team Raj Kuthir Homestays – Sobuj Potro". WhatsApp/Instagram lists use `•` bullets.

## Business facts that code must respect

- Every blocked night must have a booking behind it; a manual block carries a reason.
- Rates are edited in `/admin` (floor ₹2,900/night); peak periods have a 2-night minimum.
- Every guest, children included, uploads an ID; ID count must match guest count. Rejections always state the reason and upload instructions.
- MakeMyTrip + Goibibo are one calendar; the four calendars are MMT/Goibibo, Airbnb, Booking.com, website.

## Reporting back to me

Short. What changed, what I must do, what's risky. No step-by-step recaps. I often pass reports to ChatGPT, so state concrete facts (routes, file paths, figures) and correct any wrong assumption in my brief.
