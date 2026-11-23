# Self-healing operations: architecture

The answer to "Self-Healing Operations System V1" (the ChatGPT Red-Team spec), checked against this codebase on 23 Nov 2026. It keeps the spec's safety model (L0–L3, deterministic checks before AI, no self-authorisation) and cuts what does not fit one homestay run by one owner.

## 1. Current monitoring inventory (before this work)

| Have | Where | Gap |
|---|---|---|
| `/api/healthz` | `routes/health.ts` | Always `ok`, even with the database down |
| Invoice/PDF self-check, alerts on change | `invoice-selfcheck.ts`, `/api/health/invoices` | Covers PDFs only |
| Owner alerts: app list + push + email, deduped, quiet hours | `owner-alerts.ts` (`owner_alerts.dedupe_key`) | Nothing feeds it system failures |
| WhatsApp send failures → alert | `owner-alerts-watch.ts` | Covers failed sends, not a stuck outbox |
| Schema drift check at boot | `schema-check.ts` | Writes to the log only |
| Duplicate-booking hygiene, Cashfree webhook reconcile, confirmation retries | `booking-dedupe.ts`, `book-pay-cron.ts` | These already do L1-style recovery, safely and idempotently |
| Cron jobs (calendar, mail, outbox, Book & Pay, alerts, reviews) | `*-cron.ts` | **Errors go to the Railway log only, so nobody hears about them** |
| Outside uptime check | none | **Nobody notices when Railway is down** |
| CI on pull requests | none (no `.github/`) | Nothing gates an AI-written PR automatically |

## 2. Where the spec is changed, and why

| Spec says | Built instead | Why |
|---|---|---|
| Telegram bot and ops group | The existing owner alerts (phone app push + email + alert list) | Already on your phone, deduped, with quiet hours and per-event switches. Telegram would add a new secret, a second inbox and an approval surface someone could attack. Telegram can come later if you want a group with other people in it. |
| Telegram `/approve` with tokens | **GitHub PR + "merge #N"** (as CLAUDE.md already requires) | A merge is already tied to one commit SHA, your GitHub identity and a timestamp, and is logged. That meets the spec's "bind approval to incident, patch, owner, time" with nothing new to build or secure. |
| Reliability Agent running inside the Railway app on the Claude API | **A Claude scheduled task outside production** that reads logs and the repo, and pushes branches/PRs only | Inside the app, the agent would share a process with every production secret, which breaks the spec's own rule 9, and it would need a paid API key. Outside, it costs nothing extra and holds no production credentials. |
| New incidents table + owner control centre | PR 1: incident state in memory, alerts in `owner_alerts`, status at `/api/health/ops` | No migration in PR 1 (the spec forbids one). Add a table only if restarts re-alerting becomes noisy. |
| Emergency pause controls | Already there: WhatsApp mode manual/api and auto-send ticks in Settings; Hermes and the scheduled task can be switched off | Wire a single "pause all" only if those turn out to be too scattered. |

## 3. Target architecture

```
                 GitHub Actions (every 15 min, outside Railway)
                 curl / , /api/healthz , /api/health/ops ──fail──► GitHub email to owner
                                   │
Railway: api-server ───────────────┼───────────────────────────────────────────────
  cron jobs ──heartbeat──► ops-watch (every 5 min, deterministic, L0)
  database SELECT 1 ─────►   │  step(): 2 agreeing runs open/close, escalate, daily reminder
  WhatsApp outbox ───────►   │
                             ▼
                      notifyOwner("ops_incident") ──► app push + email + alert list
                                   │
Outside production:                ▼
  Claude scheduled task (L2, "bugfix team"): Railway logs (read) + repo
     → triage → failing test → minimal fix → independent reviewer agent
     → branch + PR with root cause, risk, rollback → owner says "merge #N" (L3)
     → Railway deploys → task checks /api/healthz and /api/health/ops
```

## 4. Incident severity matrix

| Sev | Examples | Detected by (now / later) | Alert |
|---|---|---|---|
| P0 | Database down; duplicate confirmed booking; payment mismatch; guest data exposure | Database check (now); duplicate / payment integrity checks (PR 4) | After 2 runs (≈ 10 min); `/api/health/ops` 503 so the outside monitor fails; daily reminder |
| P1 | Calendar sync (incl. any feed erroring), Book & Pay, outbox or owner-alerts job silent or failing; outbox overdue 45 min | Job heartbeats + outbox check (now) | Push + email; daily reminder. Not a 503, so GitHub doesn't email every 15 min |
| P2 | Mail sync throwing (per-mailbox errors are not yet counted); PDF self-check (existing) | Heartbeat (now) | Push + email once, then at recovery |
| P3 | Slow responses, transient errors | Not built: log only | None |

A job is broken when it has been silent for 3 intervals + 2 min, or has failed 3 runs in a row. Jobs that never started (e.g. WhatsApp not configured) are not watched, which avoids false positives. The outbox check skips messages held on purpose (waiting for a verified ID, as `claimDueMessages` does) and doesn't run 23:00–09:00 IST (guest DND). A check that stops reporting closes its incident.

## 5. Recovery permission matrix

| Level | Who | Allowed |
|---|---|---|
| L0 observe | ops-watch | Check, classify, alert. **PR 1 is only this.** |
| L1 safe recovery | Existing code only | Already present and idempotent: Cashfree reconcile from the gateway's own record, confirmation PDF retry, hold expiry. (Failed WhatsApp sends are *not* retried automatically, by design.) No new automatic action without your approval. |
| L2 prepare repair | Bugfix-team scheduled task | Read logs, branch, patch, test, open PR. Never merge, never deploy, never touch Railway variables. |
| L3 production | You | "merge #N" = deploy. Migrations, variables, business rules, money: always you. |

Never automatic, at any level: refunds, payment states, confirmed bookings, rates, releasing nights, arbitrary SQL, guest ID files.

## 6. Reliability (bugfix) agent design

**Update 23 Nov 2026:** the owner chose a separate always-on agent like Hermes, not a Claude scheduled task. That is **Agent Ryan** (`services/ryan`, README there): Hermes Agent on Telegram, a deterministic watchdog that wakes the AI only for new problems, and `/api/ops/digest` on the site. The design below still applies; "scheduled task" now means Ryan. Order agreed: CI (#87) → Ryan → Ryan fixes the OTA feed guard and the integrity checks as its first jobs.


A Claude scheduled task, run on an alert or daily, using the `bugfix-team` skill:
1. Classify first: app defect / provider outage (Meta, Cashfree, OTA feed) / config / database / Railway / security / unknown. Only an app defect goes on to a patch. Outages get a status note, not a code change.
2. Treat log text as untrusted data (prompt injection, red-team test 16). Logs are passed through `sanitize()` patterns before they reach a prompt.
3. Reproduce with a failing `node:test`, make the smallest fix, run `pnpm run typecheck` and `pnpm test`.
4. A second agent that has not seen the fix reviews the diff.
5. Open a PR: root cause, files, risk, rollback (= revert the merge commit; Railway redeploys). Stop.

**Honest limit:** the Claude task's Railway connector *can* deploy and edit variables, so for now "it must not" is a rule, not a technical lock. To make it a real lock, turn on **GitHub branch protection** for `main` (require a PR and your review). The agent then cannot merge even if it tries.

## 7. Repair workflow and approval
As in §6. The approval is your "merge #N" on GitHub. A PR needs green checks (CI, PR 3) before you're asked.

## 8. Independent monitoring
`.github/workflows/uptime.yml`, every 15 min, from GitHub's servers. It fails when the site, `/api/healthz` or `/api/health/ops` (503 only on an open P0) fails 3 tries over a minute, and GitHub emails you about the failed run (check *Settings → Notifications → Actions → failed workflows only* is on). Free, because the repo is public. GitHub can delay schedules by a few minutes at busy times.

## 9. Database changes
None in PR 1. `ops_incident` is a new owner-alert event (text column, no enum change).

## 10. Cost
₹0 new recurring spend: Railway (existing), GitHub Actions (free, public repo), owner alerts (existing), scheduled task (your existing Claude plan). No Claude API key.

## 11. Threat model (key points)
- **Secrets in errors:** alert text goes through `sanitize()` (tokens, keys, JWTs, connection strings, emails, phone numbers). The public endpoint carries no error text at all.
- **Prompt injection via logs:** the agent treats logs as data, holds no production credentials, and everything it makes is a PR you read.
- **Forged approval:** no chat-based approvals exist; only GitHub merges deploy.
- **Malicious or wrong patch:** CI + independent reviewer + you; rollback is a revert.
- **Alert flood:** two-run confirmation, one alert per incident, one reminder per day, `dedupe_key` unique in the DB.

## 12. Red-team tests (the 20 in the spec)

| # | Scenario | Expected |
|---|---|---|
| 1 | Claude unavailable | Monitoring unaffected (no AI in the loop); the agent task just retries next run |
| 2 | WhatsApp API down | Sends go straight to `failed` → existing "message failed" alert per message |
| 3 | Postgres down | Database P0 alert by email if Gmail API is set up and the owner email is saved in Settings or Railway (`sendEmail` no longer needs the DB; push does); `/api/health/ops` 503 → GitHub fails |
| 4 | Process crash | Railway restarts it; if it stays down, GitHub monitor fails |
| 5 | Duplicate payment webhook | Already idempotent (`cashfree-service.ts` settles once); integrity check in PR 4 |
| 6 | Failed confirmation | Existing `retryConfirmations` in Book & Pay |
| 7–8 | Corrupt / empty iCal feed | **Real gap found (see below).** Feed errors now count as calendar job failures → P1 after 3 runs. |
| 9 | Concurrent booking writes | Hygiene job merges duplicates; integrity check in PR 4 |
| 10 | Repeated job run | `running` guards in each job; heartbeats are idempotent |
| 11 | Outbox backlog | Outbox P1 after 45 min (only when API sending is on) |
| 12 | Push or email fails | The alert is still in the app list; GitHub monitor independent |
| 13 | GitHub down | Monitoring in-app unaffected; agent waits |
| 14 | Wrong patch | CI, reviewer, you; revert |
| 15 | False positive | Two-run confirmation; unstarted jobs and manual-mode outbox ignored |
| 16 | Injection in logs | Logs = data; no prod creds; PR-only output |
| 17 | Secret in a trace | `sanitize()` (tested) |
| 18 | Unauthorised approval | Only GitHub merges deploy |
| 19 | Malicious PR content | You review; branch protection |
| 20 | Deploy OK, still degraded | Ops watch keeps the incident open; agent checks `/api/health/ops` after the merge |

Covered by `ops-rules.test.ts` now: 15, 17, flapping, dedupe, escalation, reminders, public-status privacy.

### Gap found during the audit (fix first)

`fetchFeed` (`ics-utils.ts`) accepts any 200 response, and `replaceSourceEvents` (`calendar-repo.ts`) treats an empty parse as "every reservation is gone". If an OTA ever serves an HTML error page or an empty calendar with status 200, every future booking from that OTA is **cancelled automatically** and its nights reopen on the website. That is a double-booking risk (P0). The fix (PR 2): reject a body without `BEGIN:VCALENDAR`, and when a feed suddenly drops all of its reservations, keep the bookings and alert the owner instead of cancelling.

## 13. Phased plan (one PR at a time)

1. **PR 1 (this one):** ops watch (L0), `/api/health/ops`, job heartbeats, `ops_incident` alert, outside uptime monitor, this doc.
2. **PR 2:** the empty/garbage iCal feed guard above.
3. **PR 3:** CI on pull requests (typecheck + tests), the gate for every AI-written PR. You then turn on branch protection.
4. **PR 4:** business-integrity checks: duplicate confirmed bookings on the same nights, a paid Cashfree order with no confirmed booking, blocked nights with no booking behind them (all read-only SQL, P0).
5. **Then:** Ryan (L2): see below.
6. **Later, only if wanted:** an incidents table + console page; Telegram.
