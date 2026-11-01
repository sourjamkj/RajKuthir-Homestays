import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVICE_IDLE_LIMIT_MS,
  bearerFrom,
  deviceIsUsable,
  hashDeviceToken,
  isExpoPushToken,
  lastSeenIsStale,
  looksLikeDeviceToken,
  newDeviceToken,
  publicDevice,
  readDeviceInfo,
} from "./owner-devices-rules.ts";

test("phone tokens are random, well-formed, and only their hash is kept", () => {
  const a = newDeviceToken();
  const b = newDeviceToken();
  assert.notEqual(a, b);
  assert.ok(looksLikeDeviceToken(a), a);
  assert.match(hashDeviceToken(a), /^[0-9a-f]{64}$/);
  assert.notEqual(hashDeviceToken(a), hashDeviceToken(b));
  assert.ok(!hashDeviceToken(a).includes(a.slice(4, 20)));
});

test("only a well-formed Bearer phone token is read from the header", () => {
  const token = newDeviceToken();
  assert.equal(bearerFrom(`Bearer ${token}`), token);
  assert.equal(bearerFrom(`bearer   ${token}`), token);
  assert.equal(bearerFrom(token), null);
  assert.equal(bearerFrom("Bearer rkd_short"), null);
  assert.equal(bearerFrom("Bearer 1793518132.abcdef"), null, "the web cookie value is not a phone token");
  assert.equal(bearerFrom(undefined), null);
  assert.equal(bearerFrom(["Bearer x"]), null);
});

test("a signed-out or long-idle phone cannot get in", () => {
  const now = new Date("2026-11-01T10:00:00Z");
  const recent = new Date(now.getTime() - 60_000);
  assert.ok(deviceIsUsable({ revokedAt: null, lastSeenAt: recent }, now));
  assert.ok(!deviceIsUsable({ revokedAt: new Date(now.getTime() - 1), lastSeenAt: recent }, now));
  assert.ok(!deviceIsUsable({ revokedAt: null, lastSeenAt: new Date(now.getTime() - DEVICE_IDLE_LIMIT_MS) }, now));
  assert.ok(deviceIsUsable({ revokedAt: null, lastSeenAt: new Date(now.getTime() - DEVICE_IDLE_LIMIT_MS + 1000) }, now));
});

test("last-seen is written now and then, not on every request", () => {
  const now = new Date("2026-11-01T10:00:00Z");
  assert.ok(!lastSeenIsStale(new Date(now.getTime() - 60_000), now));
  assert.ok(lastSeenIsStale(new Date(now.getTime() - 11 * 60_000), now));
});

test("phone name and platform are cleaned, never trusted", () => {
  assert.deepEqual(readDeviceInfo({ deviceName: "  Sourja's Pixel\n", platform: "android" }), { name: "Sourja's Pixel", platform: "android" });
  assert.deepEqual(readDeviceInfo({ deviceName: "x".repeat(200), platform: "windows" }), { name: "x".repeat(60), platform: "other" });
  assert.deepEqual(readDeviceInfo(null), { name: "Phone", platform: "other" });
});

test("only Expo push tokens are accepted", () => {
  assert.ok(isExpoPushToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"));
  assert.ok(isExpoPushToken("ExpoPushToken[abcDEF1234_-xyz]"));
  assert.ok(!isExpoPushToken("https://evil.example/push"));
  assert.ok(!isExpoPushToken("ExponentPushToken[]"));
});

test("the phone list never carries a token or a push token", () => {
  const row = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Pixel",
    platform: "android",
    createdAt: new Date("2026-11-01T00:00:00Z"),
    lastSeenAt: new Date("2026-11-01T01:00:00Z"),
    revokedAt: null,
    pushToken: "ExponentPushToken[secretsecretsecret]",
  };
  const shown = publicDevice(row, row.id);
  assert.equal(shown.pushEnabled, true);
  assert.equal(shown.thisDevice, true);
  assert.ok(!JSON.stringify(shown).includes("secret"));
});
