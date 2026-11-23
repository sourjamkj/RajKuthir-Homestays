import { timingSafeEqual } from "node:crypto";

/** The agent's token, compared in constant time. False when HERMES_MCP_TOKEN is unset or short. */
export function guestTokenMatches(authorization: string | undefined, expected = process.env["HERMES_MCP_TOKEN"]?.trim()): boolean {
  if (!expected || expected.length < 24 || !authorization?.startsWith("Bearer ")) return false;
  const given = Buffer.from(authorization.slice("Bearer ".length).trim());
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}
