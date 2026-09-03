import crypto from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { logger } from "./logger";

/**
 * Self-hosted admin auth.
 *
 * There is exactly one admin (the owner), so this deliberately avoids an
 * external identity provider. A password is checked against a scrypt hash
 * held in an environment variable, and success issues an HMAC-signed
 * session cookie. Nothing is stored server-side, so restarts and multiple
 * instances work without a session table.
 *
 * Required environment variables (generate both with
 * `node scripts/hash-admin-password.mjs`):
 *   RAJ_KUTHIR_ADMIN_PASSWORD_HASH  scrypt$<saltHex>$<keyHex>
 *   RAJ_KUTHIR_SESSION_SECRET       long random string used to sign cookies
 */

export const ADMIN_COOKIE_NAME = "rk_admin";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SCRYPT_KEYLEN = 64;

const PASSWORD_HASH = process.env["RAJ_KUTHIR_ADMIN_PASSWORD_HASH"]?.trim();
const SESSION_SECRET = process.env["RAJ_KUTHIR_SESSION_SECRET"]?.trim();
const IS_PRODUCTION = process.env["NODE_ENV"] === "production";

export function isAdminAuthConfigured(): boolean {
  return Boolean(PASSWORD_HASH && SESSION_SECRET);
}

if (!isAdminAuthConfigured()) {
  logger.warn(
    {
      hasPasswordHash: Boolean(PASSWORD_HASH),
      hasSessionSecret: Boolean(SESSION_SECRET),
    },
    "Admin auth is not configured — admin routes will refuse every request. " +
      "Set RAJ_KUTHIR_ADMIN_PASSWORD_HASH and RAJ_KUTHIR_SESSION_SECRET.",
  );
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  // timingSafeEqual throws on length mismatch, so compare lengths first.
  // The length itself is not secret.
  return (
    left.length === right.length && crypto.timingSafeEqual(left, right)
  );
}

/**
 * Checks a candidate password against RAJ_KUTHIR_ADMIN_PASSWORD_HASH.
 * Always performs the scrypt work, even when unconfigured or malformed, so
 * response timing does not reveal which case was hit.
 */
export async function verifyAdminPassword(
  candidate: string,
): Promise<boolean> {
  const parts = (PASSWORD_HASH ?? "").split("$");
  const isWellFormed = parts.length === 3 && parts[0] === "scrypt";

  const saltHex = isWellFormed ? parts[1]! : "00";
  const keyHex = isWellFormed ? parts[2]! : "00".repeat(SCRYPT_KEYLEN);

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(keyHex, "hex");
  } catch {
    return false;
  }

  const derived = await scryptAsync(
    candidate,
    salt,
    expected.length || SCRYPT_KEYLEN,
  );

  if (!isWellFormed) return false;
  return safeEqual(derived, expected);
}

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", SESSION_SECRET ?? "")
    .update(payload)
    .digest("hex");
}

export function createSessionToken(now = Date.now()): string {
  const expiresAt = now + SESSION_TTL_MS;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
}

export function isValidSessionToken(
  token: unknown,
  now = Date.now(),
): boolean {
  if (!SESSION_SECRET || typeof token !== "string") return false;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt)) return false;

  // Verify the signature before trusting the expiry it carries.
  let signatureMatches = false;
  try {
    signatureMatches = safeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(sign(payload), "hex"),
    );
  } catch {
    return false;
  }

  return signatureMatches && expiresAt > now;
}

export function setSessionCookie(res: Response): void {
  res.cookie(ADMIN_COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PRODUCTION,
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(ADMIN_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PRODUCTION,
    path: "/",
  });
}

export function isSignedIn(req: Request): boolean {
  const cookies = (req as Request & { cookies?: Record<string, unknown> })
    .cookies;
  return isValidSessionToken(cookies?.[ADMIN_COOKIE_NAME]);
}

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!isAdminAuthConfigured()) {
    res.status(503).json({ error: "Admin access is not configured yet." });
    return;
  }

  if (!isSignedIn(req)) {
    res.status(401).json({ error: "Admin sign-in required." });
    return;
  }

  next();
};

/**
 * Small in-memory throttle for the login endpoint. One process, one admin —
 * a Map is enough, and losing the counters on restart is acceptable.
 */
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

export function tooManyAttempts(key: string, now = Date.now()): boolean {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) return false;
  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailedAttempt(key: string, now = Date.now()): void {
  const entry = attempts.get(key);

  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return;
  }

  entry.count += 1;

  // Opportunistic cleanup so the map cannot grow without bound.
  if (attempts.size > 500) {
    for (const [candidate, value] of attempts) {
      if (value.resetAt <= now) attempts.delete(candidate);
    }
  }
}

export function clearAttempts(key: string): void {
  attempts.delete(key);
}
