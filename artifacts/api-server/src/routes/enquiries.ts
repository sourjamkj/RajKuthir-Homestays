import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/admin-auth";
import { logger } from "../lib/logger";
import {
  createEnquiry,
  deleteEnquiry,
  listContacts,
  listEnquiries,
  setEnquiryStatus,
  updateContact,
  type EnquiryStatus,
} from "../lib/enquiries-repo";

const router: IRouter = Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: readonly EnquiryStatus[] = [
  "new",
  "contacted",
  "converted",
  "closed",
];

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function text(value: unknown, max: number): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw.slice(0, max) : null;
}

function count(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) return null;
  return parsed;
}

/**
 * Simple per-IP throttle on the public enquiry endpoint. This is the only
 * unauthenticated write in the app, so it is the only thing standing between
 * a bored script and a few thousand junk rows in the owner's lead list.
 */
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function tooMany(key: string, now = Date.now()): boolean {
  const entry = attempts.get(key);

  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });

    if (attempts.size > 1000) {
      for (const [candidate, value] of attempts) {
        if (value.resetAt <= now) attempts.delete(candidate);
      }
    }

    return false;
  }

  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

/** Public: the guest enquiry form posts here. */
router.post("/enquiries", async (req, res) => {
  if (tooMany(req.ip ?? "unknown")) {
    res.status(429).json({
      error: "Too many enquiries from this connection. Please try again later.",
    });
    return;
  }

  const name = text(req.body?.name, 200);
  const phone = text(req.body?.phone, 40);

  if (!name || !phone) {
    res.status(400).json({ error: "Please include a name and phone number." });
    return;
  }

  const checkIn = text(req.body?.checkIn, 10);
  const checkOut = text(req.body?.checkOut, 10);

  try {
    const created = await createEnquiry({
      name,
      phone,
      email: text(req.body?.email, 200),
      checkIn: checkIn && ISO_DATE.test(checkIn) ? checkIn : null,
      checkOut: checkOut && ISO_DATE.test(checkOut) ? checkOut : null,
      adults: count(req.body?.adults),
      children: count(req.body?.children),
      pets: count(req.body?.pets),
      requests: text(req.body?.requests, 1000),
    });

    logger.info({ enquiryId: created.id }, "Enquiry received");
    res.status(201).json({ received: true });
  } catch (error) {
    logger.error({ err: error }, "Could not save enquiry");
    // The guest has done nothing wrong; do not surface our storage problem.
    res.status(201).json({ received: true });
  }
});

router.get("/enquiries", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ enquiries: await listEnquiries() });
});

router.patch("/enquiries/:id", requireAdmin, async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;

  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid enquiry id." });
    return;
  }

  const status = String(req.body?.status ?? "") as EnquiryStatus;

  if (!STATUSES.includes(status)) {
    res.status(400).json({ error: "Choose a valid status." });
    return;
  }

  const updated = await setEnquiryStatus(id, status);

  if (!updated) {
    res.status(404).json({ error: "That enquiry no longer exists." });
    return;
  }

  res.json(updated);
});

router.delete("/enquiries/:id", requireAdmin, async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;

  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid enquiry id." });
    return;
  }

  const removed = await deleteEnquiry(id);

  if (!removed) {
    res.status(404).json({ error: "That enquiry no longer exists." });
    return;
  }

  res.status(204).end();
});

/**
 * The guest contact list for follow-ups and marketing. Admin-only: this is
 * the most personal data in the system.
 */
router.get("/contacts", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ contacts: await listContacts() });
});

router.patch("/contacts/:phone", requireAdmin, async (req, res) => {
  const phone = Array.isArray(req.params.phone) ? "" : req.params.phone;

  if (!/^\d{6,15}$/.test(phone)) {
    res.status(400).json({ error: "Invalid contact." });
    return;
  }

  const body = req.body ?? {};
  const patch: {
    marketingOptOut?: boolean;
    note?: string | null;
    tags?: string | null;
  } = {};

  if (body.marketingOptOut !== undefined) {
    patch.marketingOptOut = body.marketingOptOut === true;
  }
  if (body.note !== undefined) patch.note = text(body.note, 500);
  if (body.tags !== undefined) patch.tags = text(body.tags, 200);

  await updateContact(phone, patch);
  res.json({ saved: true });
});

export default router;
