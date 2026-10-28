import { Router, type IRouter } from "express";
import { bookings, db } from "@workspace/db";
import { eq } from "drizzle-orm";

import { requireAdmin } from "../lib/admin-auth";
import { buildInvoice, emailInvoice, invoiceStatuses } from "../lib/invoices";
import { autoEmailDecision } from "../lib/invoice-rules";
import { buildConfirmation, guestEmailFor, invoiceByToken, invoiceShareMessage, invoiceWhatsappReady, whatsappInvoice } from "../lib/invoices";
import { toWhatsappNumber } from "../lib/whatsapp-client";
import { createLimiter } from "../lib/rate-limit";
import { getOtaDocument, listStatements } from "../lib/ota-documents";

/**
 * Guest invoices in the console: status per stay, download the PDF, email
 * it, and "Paid in full" (records the balance and, at check-out, sends).
 */

const router: IRouter = Router();

const isId = (raw: unknown): raw is string => typeof raw === "string" && /^[0-9a-f-]{36}$/i.test(raw);

router.get("/admin/invoices", requireAdmin, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const ids = String(req.query.ids ?? "")
    .split(",")
    .filter(isId)
    .slice(0, 200);
  res.json({ invoices: await invoiceStatuses(ids) });
});

router.get("/admin/bookings/:id/invoice.pdf", requireAdmin, async (req, res) => {
  if (!isId(req.params.id)) {
    res.status(400).json({ error: "Invalid booking id." });
    return;
  }
  const built = await buildInvoice(req.params.id);
  if (!built.ok) {
    res.status(built.status).json({ error: built.error });
    return;
  }
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${built.invoice.filename}"`,
    "Cache-Control": "no-store, private",
  });
  res.send(Buffer.from(built.invoice.pdf));
});

router.get("/admin/bookings/:id/confirmation.pdf", requireAdmin, async (req, res) => {
  if (!isId(req.params.id)) {
    res.status(400).json({ error: "Invalid booking id." });
    return;
  }
  const built = await buildConfirmation(req.params.id);
  if (!built.ok) {
    res.status(built.status).json({ error: built.error });
    return;
  }
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${built.invoice.filename}"`,
    "Cache-Control": "no-store, private",
  });
  res.send(Buffer.from(built.invoice.pdf));
});

router.post("/admin/bookings/:id/invoice/email", requireAdmin, async (req, res) => {
  if (!isId(req.params.id)) {
    res.status(400).json({ error: "Invalid booking id." });
    return;
  }
  const to = typeof req.body?.to === "string" ? req.body.to.slice(0, 200) : null;
  const result = await emailInvoice(req.params.id, to);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ ok: true, to: result.to });
});

/** The guest settled the balance at the property. Emails the invoice now if it is due. */
router.post("/admin/bookings/:id/paid-in-full", requireAdmin, async (req, res) => {
  if (!isId(req.params.id)) {
    res.status(400).json({ error: "Invalid booking id." });
    return;
  }
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, req.params.id)).limit(1);
  if (!booking) {
    res.status(404).json({ error: "That booking no longer exists." });
    return;
  }
  if (!booking.grossPaise) {
    res.status(409).json({ error: "Add the total for the stay first (Edit details → Total)." });
    return;
  }
  const [updated] = await db
    .update(bookings)
    .set({ receivedPaise: booking.grossPaise, updatedAt: new Date() })
    .where(eq(bookings.id, booking.id))
    .returning();

  const email = await guestEmailFor(booking.id);
  const decision = autoEmailDecision({
    booking: updated!,
    email,
    alreadyEmailed: false,
    whatsappTo: invoiceWhatsappReady() ? toWhatsappNumber(booking.guestPhone) : null,
    now: new Date(),
  });
  if (decision.send) {
    const sent = decision.channel === "email" ? await emailInvoice(booking.id, email) : await whatsappInvoice(booking.id);
    res.json({ ok: true, emailed: sent.ok ? (decision.channel === "email" ? sent.to : `WhatsApp +${sent.to}`) : null });
    return;
  }
  res.json({ ok: true, emailed: null, note: decision.reason });
});

/**
 * WhatsApp: through the Cloud API (PDF attached) when it is set up;
 * otherwise a ready message with a private link, for the owner to send
 * from their own WhatsApp.
 */
router.post("/admin/bookings/:id/invoice/whatsapp", requireAdmin, async (req, res) => {
  if (!isId(req.params.id)) {
    res.status(400).json({ error: "Invalid booking id." });
    return;
  }
  if (invoiceWhatsappReady() && req.body?.manual !== true) {
    const sent = await whatsappInvoice(req.params.id);
    if (sent.ok) {
      res.json({ sent: true, to: sent.to });
      return;
    }
    if (sent.status !== 502) {
      res.status(sent.status).json({ error: sent.error });
      return;
    }
    // The API refused: fall through to the manual message rather than fail.
  }
  const share = await invoiceShareMessage(req.params.id);
  if (!share.ok) {
    res.status(share.status).json({ error: share.error });
    return;
  }
  res.json({ sent: false, whatsappUrl: share.whatsappUrl, text: share.text });
});

/** The guest's private invoice link (token in the fragment, posted here). */
const guestLimiter = createLimiter(30, 60 * 60 * 1000);
router.post("/invoice/pdf", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (guestLimiter(req.ip ?? "unknown")) {
    res.status(429).json({ error: "Too many requests. Please try again later." });
    return;
  }
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const invoice = await invoiceByToken(token);
  if (!invoice) {
    res.status(404).json({ error: "This invoice link is not valid. Please ask us for a new one." });
    return;
  }
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${invoice.filename}"`,
    "X-Content-Type-Options": "nosniff",
  });
  res.send(Buffer.from(invoice.pdf));
});

/** PDFs from OTA emails: one by id, or the list of monthly statements. */
router.get("/admin/ota-documents", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ documents: await listStatements() });
});

router.get("/admin/ota-documents/:id", requireAdmin, async (req, res) => {
  const doc = isId(req.params.id) ? await getOtaDocument(req.params.id) : null;
  if (!doc) {
    res.status(404).json({ error: "That document no longer exists." });
    return;
  }
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${doc.filename.replace(/[^\w.\- ]+/g, "_")}"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store, private",
  });
  res.send(doc.bytes);
});

export default router;
