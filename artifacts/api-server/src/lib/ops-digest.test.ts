import { test } from "node:test";
import assert from "node:assert/strict";

import { guestTokenMatches } from "./mcp-guest-rules.ts";

// The digest route passes RYAN_TOKEN ?? "": an unset Ryan token must never fall back to Hermes's.
test("digest token: unset means locked, even when Hermes's token is set", () => {
  const prev = process.env["HERMES_MCP_TOKEN"];
  process.env["HERMES_MCP_TOKEN"] = "h".repeat(32);
  try {
    assert.equal(guestTokenMatches(`Bearer ${"h".repeat(32)}`, undefined ?? ""), false);
    assert.equal(guestTokenMatches(`Bearer ${"s".repeat(32)}`, "s".repeat(32)), true);
    assert.equal(guestTokenMatches(`Bearer ${"s".repeat(31)}`, "s".repeat(32)), false);
  } finally {
    if (prev === undefined) delete process.env["HERMES_MCP_TOKEN"];
    else process.env["HERMES_MCP_TOKEN"] = prev;
  }
});
