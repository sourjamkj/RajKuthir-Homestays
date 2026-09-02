---
name: raj-kuthir-deploy-railway
description: The site is hosted on Railway (not Replit); the Express API server serves the built frontend.
---

Raj Kuthir Homestays is deployed on **Railway**, not Replit. Confirmed from
response headers on https://rajkuthirhomestays.casa (`server: railway-hikari`,
`x-railway-edge`, `x-powered-by: Express`). The `.replit` / `.replit-artifact/`
files in the repo are dead config from the original Replit scaffold.

The API server (`artifacts/api-server`) serves the built frontend static files
from `artifacts/raj-kuthir/dist/public` — the frontend must build before the
server starts.

**Build (per README):**
`pnpm install && pnpm --filter @workspace/raj-kuthir run build && pnpm --filter @workspace/api-server run build`
then `node artifacts/api-server/dist/index.mjs`.

Railway runs `pnpm install --frozen-lockfile` — it hard-fails (exit 1) on any
mismatch between the manifests and `pnpm-lock.yaml`. Always regenerate and
commit the lockfile after any dependency/catalog change.

**Custom domains:** apex `rajkuthirhomestays.casa` works. `www` subdomain must be
added as its own custom-domain entry on the Railway service to get a DNS target,
then that record added at Namecheap. DNS is managed via Namecheap.

Auto-deploys on push to `main` (the user sees Railway build logs / failure
notifications), so a bad push to main can break the deploy.
