import assert from "node:assert/strict";
import test from "node:test";
import { gmailConfig, mailFor, rawMessage, resetGmailToken, sendViaGmail } from "./gmail-api.ts";

const CONFIG = { clientId: "id", clientSecret: "secret", refreshToken: "refresh-token-1234" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const noSleep = async () => {};

/** A fake Google: token endpoint, then the send replies in order. */
function fakeGoogle(sendReplies: Array<Response | Error>, tokenReply: Response = json(200, { access_token: "at", expires_in: 3600 })) {
  const calls: Array<{ url: string; body: string }> = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body ?? "") });
    if (url.includes("oauth2")) return tokenReply.clone();
    const next = sendReplies.shift();
    if (!next) throw new Error("no more replies");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch, calls };
}

test("gmail · configured only when all three variables are set", () => {
  assert.equal(gmailConfig({}), null);
  assert.equal(gmailConfig({ GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b" }), null);
  assert.deepEqual(gmailConfig({ GMAIL_CLIENT_ID: " a ", GMAIL_CLIENT_SECRET: "b", GMAIL_REFRESH_TOKEN: "c" }), { clientId: "a", clientSecret: "b", refreshToken: "c" });
});

test("gmail · success returns Gmail's message id and sends base64url MIME", async () => {
  resetGmailToken();
  const google = fakeGoogle([json(200, { id: "18c0ffee" })]);
  const result = await sendViaGmail(CONFIG, Buffer.from("To: owner@example.com\r\n\r\nhi"), { fetch: google.fetch, sleep: noSleep });
  assert.deepEqual(result, { ok: true, id: "18c0ffee" });
  const sent = JSON.parse(google.calls[1]!.body) as { raw: string };
  assert.equal(Buffer.from(sent.raw, "base64url").toString(), "To: owner@example.com\r\n\r\nhi");
});

test("gmail · bad credentials fail at once, no retry, no secret in the error", async () => {
  resetGmailToken();
  const google = fakeGoogle([], json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }));
  const result = await sendViaGmail(CONFIG, Buffer.from("x"), { fetch: google.fetch, sleep: noSleep });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.retryable, false);
    assert.match(result.error, /invalid_grant/);
    assert.doesNotMatch(result.error, /secret|refresh-token/);
  }
  assert.equal(google.calls.length, 1);
});

test("gmail · a rejected message (400) is not retried", async () => {
  resetGmailToken();
  const google = fakeGoogle([json(400, { error: { status: "INVALID_ARGUMENT", message: "Invalid To header" } })]);
  const result = await sendViaGmail(CONFIG, Buffer.from("x"), { fetch: google.fetch, sleep: noSleep });
  assert.equal(result.ok, false);
  assert.equal(google.calls.filter((c) => c.url.includes("send")).length, 1);
});

test("gmail · timeouts and 5xx retry with doubling backoff, then succeed", async () => {
  resetGmailToken();
  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  const google = fakeGoogle([timeout, json(503, { error: { status: "UNAVAILABLE" } }), json(200, { id: "ok-3" })]);
  const waits: number[] = [];
  const result = await sendViaGmail(CONFIG, Buffer.from("x"), {
    fetch: google.fetch,
    backoffMs: 100,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  assert.deepEqual(result, { ok: true, id: "ok-3" });
  assert.deepEqual(waits, [100, 200]);
});

test("gmail · gives up after the last attempt and says why", async () => {
  resetGmailToken();
  const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
  const google = fakeGoogle([timeout, timeout, timeout]);
  const result = await sendViaGmail(CONFIG, Buffer.from("x"), { fetch: google.fetch, sleep: noSleep });
  assert.deepEqual(result, { ok: false, error: "timeout", retryable: true });
});

test("gmail · a 401 on send drops the cached token and the retry gets a fresh one", async () => {
  resetGmailToken();
  const google = fakeGoogle([json(401, { error: { status: "UNAUTHENTICATED" } }), json(200, { id: "after-refresh" })]);
  const result = await sendViaGmail(CONFIG, Buffer.from("x"), { fetch: google.fetch, sleep: noSleep });
  assert.deepEqual(result, { ok: true, id: "after-refresh" });
  assert.equal(google.calls.filter((c) => c.url.includes("oauth2")).length, 2);
});

test("gmail · the MIME carries the PDF attachment and the From line", async () => {
  const pdf = Buffer.from("%PDF-1.4 test");
  const raw = (await rawMessage(mailFor("rajkuthir@example.com", "owner@example.com", "Booking confirmed — RK-21NOV-7K4MQ", "Hello", [
    { filename: "Booking-RK-21NOV-7K4MQ.pdf", content: new Uint8Array(pdf), contentType: "application/pdf" },
  ]))).toString();
  assert.match(raw, /From: Raj Kuthir Homestays <rajkuthir@example\.com>/);
  assert.match(raw, /Content-Type: application\/pdf; name=Booking-RK-21NOV-7K4MQ\.pdf/);
  assert.ok(raw.includes(pdf.toString("base64")), "the PDF bytes are in the message");
});
