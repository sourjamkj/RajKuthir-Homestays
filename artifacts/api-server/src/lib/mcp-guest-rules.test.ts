import assert from "node:assert/strict";
import { test } from "node:test";

import { guestTokenMatches } from "./mcp-guest-rules.ts";

const token = "a".repeat(32);

test("guest connector: only the exact bearer token gets in", () => {
  assert.equal(guestTokenMatches(`Bearer ${token}`, token), true);
  assert.equal(guestTokenMatches(`Bearer ${token}x`, token), false);
  assert.equal(guestTokenMatches(token, token), false, "needs the Bearer scheme");
  assert.equal(guestTokenMatches(undefined, token), false);
});

test("guest connector: closed when the token is unset or too short", () => {
  assert.equal(guestTokenMatches("Bearer anything", undefined), false);
  assert.equal(guestTokenMatches("Bearer short", "short"), false);
});
