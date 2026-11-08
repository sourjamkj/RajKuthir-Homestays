import { Router, type IRouter, type Request } from "express";
import QRCode from "qrcode";

import { requireAdmin } from "../lib/admin-auth";
import { logger } from "../lib/logger";
import { createLimiter } from "../lib/rate-limit";
import { getRatePlan } from "../lib/rates-repo";
import { getGuestInfo } from "../lib/guest-info-repo";
import { SITE_ORIGIN } from "../lib/seo";
import { FORM_C_PORTAL_URL, readFeedback, readPeriod, registerCells, REGISTER_HEADER, toCsv } from "../lib/compliance-rules.ts";
import {
  addFeedback,
  clearFormCFiled,
  listFeedback,
  listFormC,
  listRegisterRows,
  markFormCFiled,
  resolveFeedback,
} from "../lib/compliance-repo";
import { renderDisplayBoardPdf } from "../lib/display-board.ts";

/**
 * The homestay policy's registers, for the owner console:
 *
 *   GET  /admin/compliance/register.csv   guest register, by check-in date
 *   GET  /admin/compliance/form-c         foreign / unknown-nationality stays
 *   POST /admin/compliance/form-c/:id     mark Form C filed (or unfiled)
 *   GET  /admin/compliance/display-board.pdf
 *   GET  /admin/feedback (+ .csv), POST /admin/feedback/:id
 *
 * and the one public piece, the complaints & suggestions book:
 *
 *   POST /feedback
 */

const router: IRouter = Router();
const HOUR = 60 * 60 * 1000;
const feedbackLimiter = createLimiter(5, HOUR);

const ipOf = (req: Request): string => req.ip ?? "unknown";

function bookingIdOf(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

router.get("/admin/compliance/register.csv", requireAdmin, async (req, res) => {
  const period = readPeriod(req.query.from, req.query.to);
  if (!period) {
    res.status(400).json({ error: "Dates must be YYYY-MM-DD, from before to." });
    return;
  }
  const rows = await listRegisterRows(period);
  const csv = toCsv([REGISTER_HEADER, ...registerCells(rows, new Date())]);
  const name = `guest-register${period.from ? `-${period.from}` : ""}${period.to ? `-to-${period.to}` : ""}.csv`;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send(csv);
});

router.get("/admin/compliance/form-c", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ portal: FORM_C_PORTAL_URL, stays: await listFormC(new Date()) });
});

router.post("/admin/compliance/form-c/:bookingId", requireAdmin, async (req, res) => {
  const bookingId = bookingIdOf(req.params.bookingId);
  if (!bookingId) {
    res.status(400).json({ error: "Invalid booking id." });
    return;
  }
  if (req.body?.filed === false) {
    await clearFormCFiled(bookingId);
  } else {
    const reference = typeof req.body?.reference === "string" ? req.body.reference.trim().slice(0, 60) || null : null;
    if (!(await markFormCFiled(bookingId, reference, "admin"))) {
      res.status(503).json({ error: "Could not save. Try again in a minute." });
      return;
    }
  }
  res.json({ ok: true });
});

router.get("/admin/compliance/display-board.pdf", requireAdmin, async (req, res) => {
  try {
    const [plan, info] = await Promise.all([getRatePlan(), getGuestInfo()]);
    const qr = new Uint8Array(await QRCode.toBuffer(`${SITE_ORIGIN}/feedback`, { type: "png", errorCorrectionLevel: "M", margin: 1, width: 300 }));
    const registration = typeof req.query.registration === "string" ? req.query.registration.slice(0, 60) : null;
    const bytes = await renderDisplayBoardPdf(
      {
        rates: plan.rates,
        weekendRates: plan.weekendRates,
        peaks: plan.peaks.map((p) => ({ label: p.label, minNights: p.minNights })),
        contacts: info.contacts,
        registrationNumber: registration,
        printedOn: new Date(),
      },
      qr,
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="raj-kuthir-notice-board.pdf"');
    res.send(Buffer.from(bytes));
  } catch (error) {
    logger.error({ err: error }, "Could not render the display board");
    res.status(500).json({ error: "Could not make the notice board PDF." });
  }
});

// ---------------------------------------------------------------------------
// Complaints & suggestions book
// ---------------------------------------------------------------------------

router.post("/feedback", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (feedbackLimiter(ipOf(req))) {
    res.status(429).json({ error: "Too many messages from this connection. Please try again in an hour, or WhatsApp us." });
    return;
  }
  const read = readFeedback(req.body);
  if (read.ok === "bot") {
    res.json({ ok: true });
    return;
  }
  if (read.ok === false) {
    res.status(400).json({ error: read.reason });
    return;
  }
  if (!(await addFeedback(read.value))) {
    res.status(503).json({ error: "Could not save just now. Please try again, or WhatsApp us." });
    return;
  }
  res.json({ ok: true });
});

router.get("/admin/feedback", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ entries: await listFeedback() });
});

router.get("/admin/feedback.csv", requireAdmin, async (_req, res) => {
  const entries = await listFeedback();
  const csv = toCsv([
    ["Sl no", "Date", "Type", "Name", "Contact", "Stay ref", "Message", "Status", "Action taken", "Resolved on"],
    ...[...entries].reverse().map((e, index) => [
      String(index + 1),
      e.createdAt.slice(0, 10),
      e.kind,
      e.name,
      e.contact ?? "",
      e.stayRef ?? "",
      e.message,
      e.status,
      e.ownerNote ?? "",
      e.resolvedAt ? e.resolvedAt.slice(0, 10) : "",
    ]),
  ]);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="complaints-and-suggestions.csv"');
  res.send(csv);
});

router.post("/admin/feedback/:id", requireAdmin, async (req, res) => {
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 2000) || null : null;
  const entry = await resolveFeedback(String(req.params.id), req.body?.resolved === true, note);
  if (!entry) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  res.json({ entry });
});

export default router;
