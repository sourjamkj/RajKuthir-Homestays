import crypto from "node:crypto";

/**
 * The pieces of the Claude connector's sign-in that need no database: new
 * tokens, their hashes, how long each lasts, and the signed form that carries
 * an authorization request through the owner's password page.
 *
 * Only hashes are stored. A leaked table row can neither call the connector
 * nor be turned back into a token.
 */

/** Scope of everything the connector can do: enquiries and bookings, nothing else. */
export const MCP_SCOPE = "enquiries";

export const CODE_TTL_MS = 10 * 60 * 1000; // an authorization code, used once
export const ACCESS_TTL_MS = 60 * 60 * 1000; // an access token: one hour
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000; // a refresh token: 90 days, rotated on use
export const CONSENT_TTL_MS = 15 * 60 * 1000; // the password page stays valid this long

export type GrantKind = "code" | "access" | "refresh";

const PREFIX: Record<GrantKind, string> = { code: "rkc_", access: "rka_", refresh: "rkr_" };

export function newSecret(kind: GrantKind): string {
  return PREFIX[kind] + crypto.randomBytes(32).toString("base64url");
}

export function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

/** What the password page carries between showing the form and checking it. */
export type ConsentRequest = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scopes: string[];
  resource: string | null;
  /** Milliseconds since epoch. */
  expiresAt: number;
};

function mac(secret: string, payload: string): string {
  return crypto.createHmac("sha256", `mcp-consent:${secret}`).update(payload).digest("base64url");
}

export function signConsent(request: ConsentRequest, secret: string): string {
  const payload = Buffer.from(JSON.stringify(request)).toString("base64url");
  return `${payload}.${mac(secret, payload)}`;
}

/** The request back, or null if it was altered, signed with another key, or has expired. */
export function readConsent(signed: string, secret: string, now = Date.now()): ConsentRequest | null {
  if (!secret || typeof signed !== "string" || signed.length > 8000) return null;
  const [payload, signature] = signed.split(".");
  if (!payload || !signature) return null;
  const expected = mac(secret, payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const request = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ConsentRequest;
    if (typeof request.expiresAt !== "number" || request.expiresAt <= now) return null;
    return request;
  } catch {
    return null;
  }
}

/** The redirect back to the client, with the code or the error, and the state it sent. */
export function redirectWith(redirectUri: string, params: Record<string, string | null>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value !== null) url.searchParams.set(key, value);
  return url.toString();
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The owner's password page, in the site's colours. Plain HTML: it must work before any app loads. */
export function consentPage(input: { signed: string; clientName: string; redirectHost: string; error?: string | null }): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Connect Claude · Raj Kuthir Homestays</title>
<style>
:root{--bg:#f5eadb;--card:#fffaf3;--ink:#1d3a2f;--brand:#2d6658;--muted:#6b7a72;--line:#e2d6c4;--bad:#a65e45}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px}
main{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px}
h1{font-size:22px;margin:0 0 6px}p{margin:0 0 14px;color:var(--muted)}ul{margin:0 0 18px;padding-left:20px;color:var(--ink)}li{margin:4px 0}
label{display:block;font-size:13px;font-weight:600;color:var(--muted);margin-bottom:6px}
input[type=password]{width:100%;min-height:48px;border:1px solid var(--line);border-radius:12px;padding:0 14px;font-size:16px;background:#fff;color:var(--ink)}
.row{display:flex;gap:10px;margin-top:16px}button{flex:1;min-height:48px;border-radius:999px;font-size:15px;font-weight:600;cursor:pointer}
.ok{background:var(--brand);color:#fff;border:0}.no{background:transparent;color:var(--brand);border:1px solid var(--brand)}
.err{color:var(--bad);font-weight:600}.small{font-size:13px;margin-top:16px}
</style></head><body><main>
<h1>Connect Claude</h1>
<p><strong>${escape(input.clientName)}</strong> (${escape(input.redirectHost)}) is asking to work with your Raj Kuthir console.</p>
<p>If you allow it, it can:</p>
<ul><li>see, add and edit enquiries, including the price you agree</li><li>send quotes and mark the advance received</li><li>create bookings and see upcoming stays</li><li>check availability and the rate card</li></ul>
<p>It cannot change settings, rates, money records or signed-in phones.</p>
${input.error ? `<p class="err" role="alert">${escape(input.error)}</p>` : ""}
<form method="post" action="/oauth/consent">
<input type="hidden" name="request" value="${escape(input.signed)}">
<label for="password">Your admin password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
<div class="row"><button class="no" type="submit" name="decision" value="deny" formnovalidate>Don't allow</button><button class="ok" type="submit" name="decision" value="allow">Allow</button></div>
</form>
<p class="small">Only allow this if you started it from Claude yourself just now. You can disconnect at any time from Claude's connector settings or from Settings in your console.</p>
</main></body></html>`;
}
