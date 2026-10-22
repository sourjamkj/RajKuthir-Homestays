import { Router, type IRouter } from "express";

import { requireAdmin } from "../lib/admin-auth";
import { caretakerQueue, markCaretakerItem } from "../lib/caretaker-alerts";
import { logger } from "../lib/logger";

/**
 * The caretaker queue in the owner console: messages due now (new booking,
 * arriving tomorrow, leaving tomorrow, cancelled), each with a WhatsApp link
 * the owner taps to send from their own phone. Admin-only.
 */
const router: IRouter = Router();

router.get("/admin/caretaker/queue", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    res.json({ items: await caretakerQueue() });
  } catch (error) {
    logger.error({ err: error }, "Could not build the caretaker queue");
    res.status(500).json({ error: "Could not load caretaker messages." });
  }
});

router.post("/admin/caretaker/:bookingId/:kind", requireAdmin, async (req, res) => {
  const bookingId = Array.isArray(req.params.bookingId) ? "" : req.params.bookingId;
  const kind = Array.isArray(req.params.kind) ? "" : req.params.kind;
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) {
    res.status(400).json({ error: "Invalid booking id." });
    return;
  }
  const outcome = req.body?.outcome === "skipped" ? "skipped" : "sent";
  const ok = await markCaretakerItem(bookingId, kind, outcome);
  if (!ok) {
    res.status(400).json({ error: "Unknown message type." });
    return;
  }
  res.json({ ok: true, outcome });
});

export default router;
