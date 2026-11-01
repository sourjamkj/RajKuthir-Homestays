import { Router, type IRouter } from "express";
import { requireAdmin, sessionOf } from "../lib/admin-auth";
import { audit } from "../lib/owner-devices";
import {
  listRecentMessages,
  markSentManually,
  setMessageStatus,
} from "../lib/notifications-repo";
import { runNotifications, scheduleUpcoming } from "../lib/notifications";
import { isWhatsappConfigured } from "../lib/whatsapp-client";
import { guestApiSendingOn } from "../lib/whatsapp-mode";
import { whatsappMode } from "../lib/owner-settings-state";

const router: IRouter = Router();

// Everything here is the guest message outbox: phone numbers and message
// bodies. Admin only, without exception.
router.use("/notifications", requireAdmin);

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function idFrom(raw: unknown): string {
  return Array.isArray(raw) ? "" : String(raw ?? "");
}

/** The outbox, newest first, plus whether sending is actually switched on. */
router.get("/notifications", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    configured: isWhatsappConfigured(),
    enabled: guestApiSendingOn(),
    mode: whatsappMode(),
    messages: await listRecentMessages(100),
  });
});

/** Releases a draft so the next drain picks it up. */
router.post("/notifications/:id/approve", async (req, res) => {
  const id = idFrom(req.params.id);

  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid message id." });
    return;
  }

  const updated = await setMessageStatus(id, "pending");

  if (!updated) {
    res.status(404).json({ error: "That message no longer exists." });
    return;
  }

  res.json(updated);
});

router.post("/notifications/:id/cancel", async (req, res) => {
  const id = idFrom(req.params.id);

  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid message id." });
    return;
  }

  const updated = await setMessageStatus(id, "cancelled");

  if (!updated) {
    res.status(404).json({ error: "That message no longer exists." });
    return;
  }

  res.json(updated);
});

/**
 * Manual mode: the owner sent this from their own WhatsApp. Marks it sent so
 * the API can never send it again later, and logs who did it.
 */
router.post("/notifications/:id/sent-manually", async (req, res) => {
  const id = idFrom(req.params.id);

  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid message id." });
    return;
  }

  const session = sessionOf(res);
  const updated = await markSentManually(id, session.via);

  if (!updated) {
    res.status(409).json({ error: "That message was already sent or cancelled." });
    return;
  }

  void audit({
    via: session.via,
    deviceId: session.via === "app" ? session.deviceId : null,
    action: "whatsapp.sent_manually",
    detail: { messageId: id, kind: updated.kind },
  });
  res.json(updated);
});

/**
 * Re-runs the scheduler without sending, so the owner can see what would be
 * queued for current bookings before switching sending on.
 */
router.post("/notifications/refresh", async (_req, res) => {
  const queued = await scheduleUpcoming();
  res.json({ queued });
});

/** Schedules and drains now, rather than waiting for the 15-minute cron. */
router.post("/notifications/run", async (_req, res) => {
  res.json(await runNotifications());
});

export default router;
