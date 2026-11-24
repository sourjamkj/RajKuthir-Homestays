import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedOwnerTelegramTarget } from "./telegram-owner-rules.ts";

test("allows the configured owner private chat only when allow-listed", () => {
  assert.equal(isAllowedOwnerTelegramTarget("1140654260", "1140654260"), true);
  assert.equal(isAllowedOwnerTelegramTarget("1140654260", "123, 1140654260"), true);
});

test("rejects a target not in the owner allow-list", () => {
  assert.equal(isAllowedOwnerTelegramTarget("1140654260", "123"), false);
  assert.equal(isAllowedOwnerTelegramTarget("123", "1140654260"), false);
});

test("rejects absent, malformed and group targets", () => {
  assert.equal(isAllowedOwnerTelegramTarget(undefined, "1140654260"), false);
  assert.equal(isAllowedOwnerTelegramTarget("-100123", "-100123"), false);
  assert.equal(isAllowedOwnerTelegramTarget("@mychannel", "@mychannel"), false);
  assert.equal(isAllowedOwnerTelegramTarget("0", "0"), false);
});
