import { createHash, randomBytes } from "node:crypto";

/**
 * Sign-in for the owner's phone app. Pure rules; the table lives in
 * owner-devices.ts.
 *
 * The web console keeps its signed cookie. The app cannot hold a cookie the
 * same way, and a phone can be lost, so each phone gets its own random token:
 *
 *  - the token is shown to the phone once and stored there in Android's
 *    secure storage, unlocked by the owner's fingerprint;
 *  - the server keeps only its SHA-256, so a database read cannot sign
 *    anyone in;
 *  - each phone is a row the owner can sign out from the console, and a
 *    phone unused for 90 days signs itself out.
 */

export const DEVICE_TOKEN_PREFIX = "rkd_";
export const DEVICE_IDLE_LIMIT_MS = 90 * 24 * 60 * 60 * 1000;
/** last_seen_at is written at most this often, not on every request. */
export const LAST_SEEN_WRITE_EVERY_MS = 10 * 60 * 1000;

export function newDeviceToken(): string {
  return DEVICE_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function looksLikeDeviceToken(value: unknown): value is string {
  return typeof value === "string" && /^rkd_[A-Za-z0-9_-]{43}$/.test(value);
}

/** The token from an `Authorization: Bearer …` header, or null. */
export function bearerFrom(header: unknown): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match && looksLikeDeviceToken(match[1]) ? match[1] : null;
}

export type DeviceRow = {
  id: string;
  name: string;
  platform: string;
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  pushToken: string | null;
};

export function deviceIsUsable(device: Pick<DeviceRow, "revokedAt" | "lastSeenAt">, now: Date): boolean {
  if (device.revokedAt) return false;
  return now.getTime() - device.lastSeenAt.getTime() < DEVICE_IDLE_LIMIT_MS;
}

export function lastSeenIsStale(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() >= LAST_SEEN_WRITE_EVERY_MS;
}

/** What the phone sends when it signs in. Trimmed, bounded, plain text. */
export function readDeviceInfo(body: unknown): { name: string; platform: "android" | "ios" | "other" } {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = typeof b.deviceName === "string" ? b.deviceName : "";
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60) || "Phone";
  const platform = b.platform === "android" || b.platform === "ios" ? b.platform : "other";
  return { name, platform };
}

/** Expo push tokens look like ExponentPushToken[xxxxxxxx]. Anything else is refused. */
export function isExpoPushToken(value: unknown): value is string {
  return typeof value === "string" && /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$/.test(value);
}

/** The list the console shows: never the token hash, never the push token itself. */
export function publicDevice(device: DeviceRow, currentId: string | null) {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    createdAt: device.createdAt.toISOString(),
    lastSeenAt: device.lastSeenAt.toISOString(),
    signedOut: Boolean(device.revokedAt),
    pushEnabled: Boolean(device.pushToken),
    thisDevice: device.id === currentId,
  };
}
