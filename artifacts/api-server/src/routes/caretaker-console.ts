import { Router, type IRouter } from "express";

import { requireAdmin, sessionOf } from "../lib/admin-auth";
import { listAllEvents } from "../lib/calendar-repo";
import { buildMonth, parseMonth } from "../lib/calendar-month-rules";
import {
  CARETAKER_TEMPLATES,
  caretakerWhatsappLink,
  istToday,
  renderCaretakerMessage,
  validateCaretakerMessage,
} from "../lib/caretaker-messages-rules";
import {
  markCaretakerMessageSent,
  recentCaretakerMessages,
  recordCaretakerMessage,
} from "../lib/caretaker-messages";
import { logger } from "../lib/logger";
import { audit } from "../lib/owner-devices";
import { caretakerName, caretakerWhatsappNumber, ownerSignature } from "../lib/owner-settings-state";
import { readLiveHolds } from "../lib/book-pay-repo";
import { getRatePlan, rateForNight } from "../lib/rates-repo";

/**
 * Two owner screens, shared by the web console and the phone app:
 *  - the caretaker console (messages to the caretaker, with history);
 *  - the month calendar (one call, everything a phone needs to draw it).
 */
const router: IRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/* ------------------------------------------------------- caretaker */

router.get("/admin/caretaker/messages", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    res.json({
      caretaker: { name: caretakerName(), phone: caretakerWhatsappNumber() },
      signature: ownerSignature(),
      templates: CARETAKER_TEMPLATES,
      today: istToday(new Date()),
      history: await recentCaretakerMessages(),
    });
  } catch (error) {
    logger.error({ err: error }, "Could not load caretaker messages");
    res.status(500).json({ error: "Could not load the caretaker's messages." });
  }
});

/** Preview only: the finished text, nothing stored. */
router.post("/admin/caretaker/messages/preview", requireAdmin, (req, res) => {
  const checked = validateCaretakerMessage(req.body);
  if (!checked.ok) {
    res.status(400).json({ error: checked.error });
    return;
  }
  const body = renderCaretakerMessage(checked.kind, checked.fields, { caretakerName: caretakerName(), ownerSignature: ownerSignature() }, istToday(new Date()));
  res.json({ body });
});

/**
 * Writes the message, keeps it in the history, and returns the wa.me link that
 * opens the owner's own WhatsApp on the caretaker's chat with it typed. The
 * owner presses send in WhatsApp; then "Mark sent".
 */
router.post("/admin/caretaker/messages", requireAdmin, async (req, res) => {
  const checked = validateCaretakerMessage(req.body);
  if (!checked.ok) {
    res.status(400).json({ error: checked.error });
    return;
  }
  const phone = caretakerWhatsappNumber();
  const body = renderCaretakerMessage(checked.kind, checked.fields, { caretakerName: caretakerName(), ownerSignature: ownerSignature() }, istToday(new Date()));
  const whatsappUrl = caretakerWhatsappLink(phone, body);
  if (!whatsappUrl) {
    res.status(409).json({ error: "The caretaker's WhatsApp number is not a valid Indian mobile. Fix it in Settings." });
    return;
  }
  const session = sessionOf(res);
  try {
    const message = await recordCaretakerMessage({
      kind: checked.kind,
      fields: checked.fields,
      body,
      toPhone: phone,
      via: session.via,
      deviceId: session.via === "app" ? session.deviceId : null,
    });
    void audit({ via: session.via, deviceId: session.via === "app" ? session.deviceId : null, action: "caretaker.message", detail: { id: message.id, kind: message.kind } });
    res.status(201).json({ message, whatsappUrl });
  } catch (error) {
    logger.error({ err: error }, "Could not save a caretaker message");
    res.status(500).json({ error: "Could not save the message just now. Please try again." });
  }
});

router.post("/admin/caretaker/messages/:id/sent", requireAdmin, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Invalid message id." });
    return;
  }
  const updated = await markCaretakerMessageSent(id);
  if (!updated) {
    res.status(404).json({ error: "That message is not in the history." });
    return;
  }
  res.json(updated);
});

/* ------------------------------------------------------- calendar */

/** GET /api/admin/calendar/month?month=2026-11 → every day of the month, ready to draw. */
router.get("/admin/calendar/month", requireAdmin, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const today = istToday(new Date());
  const month = parseMonth(req.query.month, today);
  try {
    const [events, holds, plan] = await Promise.all([listAllEvents(), readLiveHolds().catch(() => []), getRatePlan()]);
    res.json(
      buildMonth({
        month,
        today,
        events: events.map((e) => ({ id: e.id, source: e.source, startDate: e.startDate, endDate: e.endDate, title: e.title, origin: e.origin })),
        holds,
        peaks: plan.peaks.map((p) => ({ label: p.label, startDate: p.startDate, endDate: p.endDate, minNights: p.minNights })),
        priceFor: (date) => {
          try {
            return rateForNight(plan, date, 2);
          } catch {
            return null;
          }
        },
      }),
    );
  } catch (error) {
    logger.error({ err: error }, "Could not build the month calendar");
    res.status(500).json({ error: "Could not load the calendar just now." });
  }
});

export default router;
