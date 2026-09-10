import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/admin-auth";
import { logger } from "../lib/logger";
import {
  getGuestInfo,
  hasGuestInfo,
  setGuestInfo,
} from "../lib/guest-info-repo";
import { lookupBooking } from "../lib/guest-lookup";

const router: IRouter = Router();

/**
 * The printed arrival poster, served to guests who have proved a live booking.
 *
 * It lives OUTSIDE artifacts/raj-kuthir/public deliberately. Anything in that
 * folder is copied to the site root and served at a plain URL to anyone who
 * asks — and this PDF carries the Wi-Fi QR code (which encodes the network
 * credentials) plus the personal mobile numbers of the caretaker, electrician,
 * plumber, cafe and toto driver. It has to come through the same gate as the
 * rest of the pack, so it is streamed from here after a reference check.
 *
 * Resolved against several candidate paths for the same reason app.ts does:
 * the process may be started from the repo root or from the service directory,
 * and from src or from dist.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

const PACK_CANDIDATES = [
  process.env.ARRIVAL_PACK_PDF,
  path.resolve(process.cwd(), "assets/arrival-pack.pdf"),
  path.resolve(process.cwd(), "artifacts/api-server/assets/arrival-pack.pdf"),
  path.resolve(here, "../../assets/arrival-pack.pdf"),
  path.resolve(here, "../../../assets/arrival-pack.pdf"),
].filter(Boolean) as string[];

function findPackPdf(): string | null {
  return PACK_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * Rate limiting for the public lookup.
 *
 * Deliberately its OWN counter rather than the one in admin-auth: those are
 * keyed by IP, and a guest fumbling their reference from the house Wi-Fi must
 * never be able to lock the owner out of the admin login from the same address.
 */
const MAX_ATTEMPTS = 12;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function tooMany(key: string, now = Date.now()): boolean {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) return false;
  return entry.count >= MAX_ATTEMPTS;
}

function recordMiss(key: string, now = Date.now()): void {
  const entry = attempts.get(key);

  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }

  // Keep the map from growing without bound on a long-running process.
  if (attempts.size > 500) {
    for (const [candidate, value] of attempts) {
      if (value.resetAt <= now) attempts.delete(candidate);
    }
  }
}

const MESSAGES = {
  not_found:
    "We could not find that booking reference. Check it against your confirmation, or message the host and we will sort it out.",
  ended:
    "That stay has already ended, so the arrival details are no longer available. Do come back.",
  cancelled:
    "That booking shows as cancelled. If that is wrong, please message the host.",
  phone_mismatch:
    "That mobile number does not match the one on this booking. Use the number you booked with, or message the host.",
} as const;

/**
 * Public. A guest enters the reservation number from their confirmation and
 * gets the arrival pack — but only while the stay is still running. The
 * details are never rendered into the public bundle; they are fetched here,
 * after a match, and never cached.
 */
router.post("/guest/lookup", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const key = req.ip ?? "unknown";

  if (tooMany(key)) {
    res.status(429).json({
      error: "Too many attempts. Please wait a few minutes, or message the host.",
    });
    return;
  }

  const raw = req.body?.reference;
  const reference = typeof raw === "string" ? raw : "";
  const rawPhone = req.body?.phone;
  const phone = typeof rawPhone === "string" ? rawPhone : "";

  if (!reference.trim()) {
    res.status(400).json({ error: "Enter your booking reference." });
    return;
  }

  const result = await lookupBooking(reference, phone);

  if (!result.ok) {
    recordMiss(key);
    res.status(404).json({ error: MESSAGES[result.reason], reason: result.reason });
    return;
  }

  const info = await getGuestInfo();

  if (!hasGuestInfo(info)) {
    // Better an honest message than a page of empty fields.
    res.status(503).json({
      error:
        "Your booking is confirmed, but the arrival details have not been published yet. Please message the host.",
    });
    return;
  }

  res.json({ booking: result.booking, info });
});

/**
 * The same reference check as /guest/lookup, then the PDF itself.
 *
 * A POST rather than a GET with a token in the query string: a URL carrying a
 * booking reference would end up in browser history, in any link a guest
 * forwards, and in our own access logs. The body keeps it out of all three.
 */
router.post("/guest/pack.pdf", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const key = req.ip ?? "unknown";

  if (tooMany(key)) {
    res.status(429).json({ error: "Too many attempts. Please wait a few minutes." });
    return;
  }

  const raw = req.body?.reference;
  const reference = typeof raw === "string" ? raw : "";
  const rawPhone = req.body?.phone;
  const phone = typeof rawPhone === "string" ? rawPhone : "";

  if (!reference.trim()) {
    res.status(400).json({ error: "Enter your booking reference." });
    return;
  }

  const result = await lookupBooking(reference, phone);

  if (!result.ok) {
    recordMiss(key);
    res.status(404).json({ error: MESSAGES[result.reason], reason: result.reason });
    return;
  }

  const file = findPackPdf();

  if (!file) {
    logger.warn({ tried: PACK_CANDIDATES }, "Arrival pack PDF not found on disk");
    res.status(503).json({
      error: "The arrival pack is not available right now. Please message the host.",
    });
    return;
  }

  res.type("application/pdf");
  res.setHeader(
    "Content-Disposition",
    'inline; filename="raj-kuthir-arrival-pack.pdf"',
  );
  res.setHeader("Content-Length", String(statSync(file).size));
  createReadStream(file).pipe(res);
});

router.get("/admin/guest-info", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await getGuestInfo());
});

router.put("/admin/guest-info", requireAdmin, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await setGuestInfo(req.body));
});

export default router;
