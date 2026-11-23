# Hermes WhatsApp guest agent

[Hermes Agent](https://hermes-agent.nousresearch.com/docs) (Nous Research, MIT) answering guest chats on the Raj Kuthir WhatsApp number. Runs as its own Railway service from this folder.

## How messages flow

```
Meta ──webhook──▶ api-server /webhooks/whatsapp   (stores it, handles STOP, Inbox)
                      │ pilot numbers / auto-reply on, and HERMES_WEBHOOK_URL set
                      ▼ same body + x-hub-signature-256, private network
                  hermes :8090/whatsapp/webhook    (verifies with the same app secret)
                      │ tools: raj-kuthir-guest MCP only (+ clarify buttons)
                      ▼
                  api-server /mcp/guest            (quote_stay: availability + price, no guest data)
Hermes ──Graph API──▶ guest                        (free-form replies inside the 24-hour window)
```

Templates (confirmations, reminders) stay with the api-server outbox; Hermes cannot send them.

## Safety

- `config.yaml` gives WhatsApp only `clarify` + `raj-kuthir-guest` and disables terminal, files, code, browser, web, memory and skills everywhere. Hermes's default for WhatsApp includes the terminal and code execution — never use the default.
- `/mcp/guest` exposes only `quote_stay`, the same answer as the public booking page. The owner's connector (`/mcp`) is never given to Hermes.
- Who gets replies: the api-server forwards only `WHATSAPP_TEST_NUMBERS` unless `WHATSAPP_AUTOREPLY_ENABLED=true` (live since 23 Nov 2026; set `false` to go back to pilot). Hermes answers everyone it is sent (`WHATSAPP_CLOUD_ALLOW_ALL_USERS=true`).
- Slash commands work only for the numbers in `allow_admin_from` (`config.yaml`); guests get none, not even /help, and a blocked command gets a plain reply (`patch_errors.py`); the owner's chat is the home channel (Dockerfile), so guests never get Hermes setup prompts.
- Guests never get Hermes housekeeping messages: no restart pings (`gateway_restart_notification: false`), no "⚡ Interrupting" ack (`HERMES_GATEWAY_BUSY_ACK_ENABLED=false`), no session-reset notice (`patch_errors.py`); idle chats reset quietly after 24h.
- Catch-all: every WhatsApp text passes `_rk_guest_safe` (patched into the adapter's `send`). Any error or system notice becomes the polite hand-off (once per chat per 2 min) and the original is logged as `RK_GUEST_ERROR {"chat":…,"text":…}` in the hermes logs, for the bug-fix agent (Railway logs filter `RK_GUEST_ERROR`).
- After upgrading `hermes-agent` in the Dockerfile, re-check that WhatsApp still resolves to exactly `clarify, raj-kuthir-guest`.
- `patch_errors.py` (run at build time) replaces Hermes's technical failure text ("model provider failed… check gateway logs") with a polite hand-off to the host (sent once: the interim status copy is dropped), and drops the "♻️ Recovered reply" prefix. The build fails if an upgrade moves the patched code.

## Railway setup

New service from this repo, **Root Directory** `services/hermes` (builds the Dockerfile), a **volume** mounted at `/data`, no public domain.

| Variable | Value | Secret? |
|---|---|---|
| `ANTHROPIC_API_KEY` | your Anthropic API key | **yes — owner enters** |
| `WHATSAPP_CLOUD_ACCESS_TOKEN` | `${{<api-server>.WHATSAPP_ACCESS_TOKEN}}` (reference) | reference |
| `WHATSAPP_CLOUD_APP_SECRET` | `${{<api-server>.WHATSAPP_APP_SECRET}}` (reference) | reference |
| `WHATSAPP_CLOUD_PHONE_NUMBER_ID` | `${{<api-server>.WHATSAPP_PHONE_NUMBER_ID}}` (reference) | reference |
| `WHATSAPP_CLOUD_VERIFY_TOKEN` | any long random string (Meta never calls Hermes directly) | yes |
| `WHATSAPP_CLOUD_ALLOWED_USERS` | `916290399165` (pilot) | no |
| `WHATSAPP_CLOUD_WABA_ID` | `1219328664284114` | no |
| `HERMES_MCP_TOKEN` | same long random value as on the api-server (24+ chars) | **yes** |
| `RAJ_KUTHIR_GUEST_MCP_URL` | `http://<api-server>.railway.internal:<PORT>/mcp/guest` | no |

On the **api-server**: `HERMES_MCP_TOKEN` (same value), `HERMES_WEBHOOK_URL=http://hermes.railway.internal:8090/whatsapp/webhook`, `WHATSAPP_TEST_NUMBERS=916290399165`.

Leave `WHATSAPP_CLOUD_WEBHOOK_HOST` unset (listens on all interfaces). If the forward fails with connection refused, set it to `::` (Railway's private network is IPv6).

## Phases

1. **Pilot (now):** answers + live price and availability, sends guests to the booking page; test number only.
2. Enquiry + priced quote with the guest's own Book link (new guest-connector tools).
3. Booking: hold dates and send the payment link; confirmation on payment as today. Cancellations and changes always hand off to the owner.
