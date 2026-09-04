import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/admin-auth";
import {
  getGuestInfo,
  hasGuestInfo,
  setGuestInfo,
} from "../lib/guest-info-repo";
import { lookupBooking } from "../lib/guest-lookup";

const router: IRouter = Router();

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

  if (!reference.trim()) {
    res.status(400).json({ error: "Enter your booking reference." });
    return;
  }

  const result = await lookupBooking(reference);

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

router.get("/admin/guest-info", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await getGuestInfo());
});

router.put("/admin/guest-info", requireAdmin, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await setGuestInfo(req.body));
});

export default router;
