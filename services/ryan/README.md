# Agent Ryan: Raj Kuthir ops agent

[Hermes Agent](https://hermes-agent.nousresearch.com/docs) (same framework as `services/hermes`) running as the site's reliability and bugfix agent. Its own Railway service; the owner talks to it on **Telegram**.

## How it works

```
every 5 min  watchdog.py (no AI)  ──GET /api/ops/digest (Bearer RYAN_TOKEN)──▶ api-server
                │ nothing new → {"wakeAgent": false}: Hermes skips the AI, costs nothing
                ▼ new incident / new error shape / site down (max 6 wake-ups a day)
             Ryan (Claude): classify → app defect? → bugfix team in /data/repo:
                branch → failing test → minimal fix → typecheck + tests → reviewer subagent
                → gh pr create → Telegram message to the owner with the PR link
owner        Telegram: "status", "fix #N", "prs", "merge #N" (→ you tap Approve; deploys)
```

The digest (`/api/ops/digest`) holds open incidents and the last warnings/errors, already sanitised by the site (no secrets, emails, phone numbers); 404 without the token.

## What it can and cannot do

| Can | Cannot (and why) |
|---|---|
| Read the digest and public health | Railway: no Railway token → cannot deploy or change variables |
| Clone the repo, run typecheck/tests, push `ryan/*` branches, open PRs | Push to `main` (deny rules + branch protection). Merge on its own: `patch_merge.py` makes `gh pr merge` wait for the owner's **Approve** tap on Telegram, and scheduled runs refuse it. Ryan merges only when you say "merge #N" to it and CI is green |
| Message the owner on Telegram | Talk to anyone else: `TELEGRAM_ALLOWED_USERS` is the owner only |
| | Database, payments, guest IDs: never given any access |
| | Change its tools: `config.yaml` is write-protected by Hermes and re-copied on every boot. Its watchdog job and script are also recreated on every boot (it *could* edit them on the volume until the next restart). |

Deny rules (`approvals.deny`) are glob matches on commands, so they're a second line only. The real locks are no Railway token, a GitHub token limited to this repo, and branch protection.

**Honest limit:** Hermes strips `GH_TOKEN`, the Anthropic key and the Telegram token from Ryan's terminal. Git still needs GitHub access, so `start.sh` signs `gh` in once and stores the login in `/data/gh`, which the agent can read. A prompt-injected Ryan could misuse that token, but only within its scope: push branches and open PRs on this public repo.

## Railway setup (owner)

1. Branch protection first: GitHub → Settings → Branches → rule for `main`: require a PR, require status check **Typecheck and tests**, block force pushes.
2. Telegram: message **@BotFather** → `/newbot` → copy the token. Message **@userinfobot** to get your numeric user ID.
3. GitHub token: Settings → Developer settings → Fine-grained tokens → **Only select repositories: RajKuthir-Homestays**. Permissions: Contents **Read and write**, Pull requests **Read and write**, Issues **Read**, Metadata Read. Expiry 90 days.
4. Railway → New service from this repo, **Root Directory** `services/ryan`, a **volume** at `/data`, no public domain.

| Variable | Value | Secret? |
|---|---|---|
| `ANTHROPIC_API_KEY` | `${{<hermes>.ANTHROPIC_API_KEY}}` (reference to the Hermes service's key) | reference |
| `TELEGRAM_BOT_TOKEN` | from BotFather | **yes, owner enters** |
| `TELEGRAM_ALLOWED_USERS` | your numeric Telegram ID | no |
| `TELEGRAM_HOME_CHANNEL` | the same ID (where alerts go) | no |
| `GH_TOKEN` | the fine-grained token (without it Ryan only watches and reports) | **yes, owner enters** |
| `RYAN_TOKEN` | a long random string (32+ chars) | **yes, owner enters** |

On the **api-server**, add Railway variable references to the three existing variables on Ryan's service (use Railway's reference picker so the service name is exact):
- `TELEGRAM_BOT_TOKEN` → Ryan's `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USERS` → Ryan's `TELEGRAM_ALLOWED_USERS`
- `TELEGRAM_HOME_CHANNEL` → Ryan's `TELEGRAM_HOME_CHANNEL`

The API uses this same bot only for outbound `sendMessage` alerts to the allow-listed positive numeric owner ID. It does not poll Telegram updates, create another bot, expose Telegram commands to caretakers or guests, or touch Ryan's incoming update loop. The owner alert outbox retries transient failures. Do not copy the token into source code.

Also on the **api-server**: `RYAN_TOKEN` (the same value). That switches on `/api/ops/digest`.

**Channel boundary:** Telegram is owner-only. WhatsApp is for guests, caretaker and Sobuj Potro Management. The caretaker alert job sends only to the caretaker's WhatsApp number; owner operational alerts are routed to Telegram and the owner app.

5. Message the bot "status". A first-run "digest unreachable" message means the two `RYAN_TOKEN` values differ.

**Pause it:** Railway → ryan → Settings → remove the service's deployment (or scale to 0). Nothing on the site depends on it.

## Models

Sonnet (`config.yaml`) does the work. Opus advises through Anthropic's advisor tool (beta `advisor-tool-2026-03-01`), added by `patch_advisor.py` at build time to Ryan's main loop and subagents only. Ryan consults it before planning, fixing and finishing (see `SOUL.md`). Set the Railway variable `ADVISOR_MODEL` to empty to switch the advisor off, or to another model to change it.

## Cost

AI runs only when the watchdog finds something new (at most 6 times a day) or you message it. Estimated ₹100–500/month at normal error rates; not measured yet. Shares Hermes's Anthropic key and limit.

## Upgrading Hermes

After changing the pinned version in the Dockerfile, re-check that `telegram` and `cron` still resolve to exactly `clarify, delegation, file, terminal, todo` (cron without `clarify`), and that the deny rules still block `git push origin main` and `gh pr merge`.
