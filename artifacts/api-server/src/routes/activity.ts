import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/admin-auth";
import { logger } from "../lib/logger";
import { listActivity, markActivitySeen } from "../lib/activity-repo";
import { seenMarker } from "../lib/activity-rules";

/**
 * What has happened since the owner last looked: new bookings (website,
 * email-imported OTA, offline), cancellations, OTA calendar blocks, website
 * enquiries and guest document uploads. Read by the bell in the admin header.
 */
const router: IRouter = Router();

router.get("/admin/activity", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    res.json(await listActivity());
  } catch (error) {
    logger.error({ err: error }, "Could not list admin activity");
    res.status(500).json({ error: "Could not load recent activity." });
  }
});

router.post("/admin/activity/seen", requireAdmin, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    await markActivitySeen(seenMarker(req.body?.upTo, new Date()));
    res.status(204).end();
  } catch (error) {
    logger.error({ err: error }, "Could not mark admin activity as seen");
    res.status(500).json({ error: "Could not mark activity as read." });
  }
});

export default router;
