import assert from "node:assert/strict";
import test from "node:test";

import { consentPage, hashSecret, newSecret, readConsent, redirectWith, signConsent, type ConsentRequest } from "./mcp-oauth-rules.ts";

const request: ConsentRequest = {
  clientId: "c1",
  clientName: "Claude",
  redirectUri: "https://claude.ai/api/mcp/auth_callback",
  codeChallenge: "abc",
  state: "s",
  scopes: ["enquiries"],
  resource: "https://rajkuthirhomestays.casa/mcp",
  expiresAt: Date.now() + 60_000,
};

test("connector · the password page's request survives only unaltered, with the right key, in time", () => {
  const signed = signConsent(request, "secret");
  assert.deepEqual(readConsent(signed, "secret"), request);
  assert.equal(readConsent(signed, "other"), null);
  assert.equal(readConsent(signed.replace(/^./, (c) => (c === "e" ? "f" : "e")), "secret"), null);
  assert.equal(readConsent(signConsent({ ...request, expiresAt: Date.now() - 1 }, "secret"), "secret"), null);
  assert.equal(readConsent(signed, ""), null);
  assert.equal(readConsent("junk", "secret"), null);
});

test("connector · secrets are random, typed by prefix, and stored only as hashes", () => {
  const a = newSecret("access");
  const b = newSecret("access");
  assert.ok(a.startsWith("rka_") && newSecret("refresh").startsWith("rkr_") && newSecret("code").startsWith("rkc_"));
  assert.notEqual(a, b);
  assert.equal(hashSecret(a), hashSecret(a));
  assert.notEqual(hashSecret(a), a);
  assert.equal(hashSecret(a).length, 64);
});

test("connector · the redirect keeps the client's address and adds the code and state", () => {
  const url = new URL(redirectWith("https://claude.ai/api/mcp/auth_callback?x=1", { code: "rkc_1", state: "s", error: null }));
  assert.equal(url.origin + url.pathname, "https://claude.ai/api/mcp/auth_callback");
  assert.equal(url.searchParams.get("x"), "1");
  assert.equal(url.searchParams.get("code"), "rkc_1");
  assert.equal(url.searchParams.get("state"), "s");
  assert.equal(url.searchParams.has("error"), false);
});

test("connector · the password page escapes what the client sent and says what it allows", () => {
  const html = consentPage({ signed: 'a"b', clientName: "<script>x</script>", redirectHost: "claude.ai" });
  assert.ok(!html.includes("<script>x</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes('value="a&quot;b"'));
  assert.match(html, /cannot change settings, rates, money records or signed-in phones/);
  assert.match(html, /autocomplete="current-password"/);
});
