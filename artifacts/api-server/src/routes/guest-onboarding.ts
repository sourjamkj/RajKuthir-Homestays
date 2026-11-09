import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/admin-auth";
import {
  buildManagementDto,
  createOrRefreshManagementAccess,
  createOrRefreshOnboarding,
  findOnboarding,
  getAdminDocument,
  getManagementDocument,
  listAdminDocuments,
  listManagementDocuments,
  listAdminGuestStays,
  rejectGuestDocuments,
  currentRejection,
  partyForPage,
  submitGuestOnboarding,
  verifyGuestDocuments,
} from "../lib/guest-onboarding-repo";
import { documentDownloadHeaders } from "../lib/document-security";
import { rejectionReasonProblem } from "../lib/document-rejection-rules";
import { maxCards, MAX_FILES_PER_SUBMIT, RATE_LADDER_MAX, type GuestAge } from "../lib/guest-id-rules";
import { getLadder } from "../lib/rates-repo";
import { EXTRA_ADULT_PAISE } from "../lib/party";

const router: IRouter = Router();
const MAX_TEXT = 500;

function clean(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v ? v.slice(0, max) : null;
}

/** A route param that must be a uuid, or null. */
function bookingIdOf(value: unknown): string | null {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) return null;
  return value;
}

function cleanToken(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

router.get("/admin/guest-stays", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ stays: await listAdminGuestStays() });
});

router.post("/admin/guest-stays/:bookingId/onboarding", requireAdmin, async (req, res) => {
  const bookingId = Array.isArray(req.params.bookingId) ? "" : req.params.bookingId;
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) {
    res.status(400).json({ error: "Invalid booking id." });
    return;
  }
  const result = await createOrRefreshOnboarding(bookingId);
  if (!result) {
    res.status(404).json({ error: "Booking not found." });
    return;
  }
  // The token goes after the '#'. A fragment is never sent to a server, so it
  // cannot reach the proxy access log, a Referer header or our own logs — see
  // the note in PreArrival.tsx. Everything after this point is unchanged: the
  // page still POSTs the token to /guest/onboarding/lookup.
  const base = `${req.protocol}://${req.get("host")}`;
  const url = `${base}/pre-arrival#${encodeURIComponent(result.token)}`;
  res.json({
    url,
    verificationDeadline: result.verificationDeadline,
    expiresAt: result.expiresAt,
    booking: {
      id: result.booking.id,
      guestName: result.booking.guestName,
      guestPhone: result.booking.guestPhone,
    },
  });
});

router.post("/guest/onboarding/lookup", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const token = cleanToken(req.body?.token);
  const found = token ? await findOnboarding(token) : null;
  if (!found) {
    res.status(404).json({ error: "This verification link is invalid or has expired." });
    return;
  }

  const now = new Date();
  const deadlinePassed = now >= found.onboarding.verificationDeadline;
  res.json({
    booking: {
      reference: found.booking.reference,
      guestName: found.booking.guestName,
      guestPhone: found.booking.guestPhone,
      checkIn: found.booking.checkIn,
      checkOut: found.booking.checkOut,
      guests: found.booking.guests,
      pets: found.booking.pets,
    },
    verificationDeadline: found.onboarding.verificationDeadline,
    deadlinePassed,
    status: found.onboarding.status,
    // Why the last upload was turned down, so the guest sees it on the page
    // they re-upload from. Null once they upload again.
    rejection: await currentRejection(found.booking.id),
    // One card per guest: who is already accepted, who must re-upload, the
    // most cards allowed, and what an extra guest costs per night.
    party: {
      booked: found.booking.guests ?? 1,
      maxCards: maxCards(found.booking.guests ?? 1),
      ...(await partyForPage(found.booking.id)),
      extraRates: await extraRates(),
    },
  });
});

async function extraRates() {
  try {
    const ladder = await getLadder();
    return { includedGuests: ladder.includedGuests, ladderPaise: ladder.extraGuestPaise, ladderMax: RATE_LADDER_MAX, abovePaise: EXTRA_ADULT_PAISE };
  } catch {
    return null;
  }
}

router.post("/guest/onboarding/submit", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const body = req.body ?? {};
  // IDs come grouped by guest now. A page opened before this change still
  // posts loose documents: ask for a reload rather than accept an upload
  // that cannot be checked against the guest count.
  if (!Array.isArray(body.guests)) {
    res.status(400).json({ error: "This page was updated. Please reload it and add one ID for each guest." });
    return;
  }
  const party = (body.guests as any[]).slice(0, 8).map((g) => ({
    slot: Number(g?.slot),
    name: clean(g?.name, 120) ?? "",
    age: (g?.age === "child" ? "child" : "adult") as GuestAge,
    idType: clean(g?.idType, 20) ?? "",
    foreign: g?.foreign === true,
    files: (Array.isArray(g?.files) ? g.files.slice(0, 3) : []).map((f: any) => ({
      side: clean(f?.side, 30) ?? "",
      documentType: "",
      source: "upload",
      originalFilename: clean(f?.originalFilename, 180),
      mimeType: clean(f?.mimeType, 100),
      dataBase64: typeof f?.dataBase64 === "string" ? f.dataBase64 : "",
    })),
  }));
  if (party.reduce((n, g) => n + g.files.length, 0) > MAX_FILES_PER_SUBMIT) {
    res.status(400).json({ error: "Too many files in one upload." });
    return;
  }
  const documents: any[] = [];
  const result = await submitGuestOnboarding({
    token: cleanToken(body.token),
    fullName: clean(body.fullName, 160) ?? "",
    phone: clean(body.phone, 40) ?? "",
    email: clean(body.email, 160),
    address: clean(body.address, 500),
    city: clean(body.city, 100),
    state: clean(body.state, 100),
    country: clean(body.country, 100),
    party,
    documents: documents.map((doc: any) => ({
      documentType: clean(doc?.documentType, 80) ?? "",
      documentNumber: clean(doc?.documentNumber, 100),
      source: clean(doc?.source, 40) ?? "upload",
      originalFilename: clean(doc?.originalFilename, 180),
      mimeType: clean(doc?.mimeType, 100),
      dataBase64: typeof doc?.dataBase64 === "string" ? doc.dataBase64 : "",
    })),
  });

  if (!result.ok) {
    const status = result.reason === "invalid_link" ? 404 : 400;
    res.status(status).json({ error: result.reason.replaceAll("_", " ") });
    return;
  }
  res.json({ saved: true, status: "verified" });
});

router.post("/admin/guest-stays/:bookingId/management-access", requireAdmin, async (req, res) => {
  const bookingId = Array.isArray(req.params.bookingId) ? "" : req.params.bookingId;
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) {
    res.status(400).json({ error: "Invalid booking id." });
    return;
  }
  const result = await createOrRefreshManagementAccess(bookingId);
  if (!result) {
    res.status(404).json({ error: "Booking not found." });
    return;
  }

  // The management message is composed from THIS payload, not from the admin
  // booking row the console already holds. buildManagementDto selects only
  // whitelisted columns, so no financial field is fetched, serialised or sent
  // on the management path at all — see ManagementGuestVerificationDTO.
  const management = await buildManagementDto(bookingId);
  if (!management) {
    res.status(404).json({ error: "Booking not found." });
    return;
  }

  // Fragment, not path — this token opens scans of a guest's government ID.
  const base = `${req.protocol}://${req.get("host")}`;
  res.json({
    url: `${base}/management-documents#${encodeURIComponent(result.token)}`,
    expiresAt: result.expiresAt,
    management,
  });
});

router.post("/management/documents/lookup", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const token = cleanToken(req.body?.token);
  const result = token ? await listManagementDocuments(token) : null;
  if (!result) {
    res.status(404).json({ error: "This document access link is invalid or has expired." });
    return;
  }
  res.json(result);
});

router.post("/management/documents/file", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const token = cleanToken(req.body?.token);
  const documentId = cleanToken(req.body?.documentId);
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) {
    res.status(400).json({ error: "Invalid document id." });
    return;
  }
  const result = token ? await getManagementDocument(token, documentId) : null;
  if (!result) {
    res.status(404).json({ error: "Document not found or access link expired." });
    return;
  }
  // Fixed octet-stream + attachment: the uploader's MIME claim is never echoed.
  res.set(documentDownloadHeaders(result.document));
  res.send(result.document.fileData);
});

/**
 * The owner's document list for one stay.
 *
 * This is the "I can view the documents" half of the veto: without it the only
 * way to actually look at a guest's ID was to mint a management link and open
 * it, which is a bearer token for someone else's eyes.
 */
router.get("/admin/guest-stays/:bookingId/documents", requireAdmin, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const bookingId = bookingIdOf(req.params.bookingId);
  if (!bookingId) {
    res.status(400).json({ error: "Invalid booking id." });
    return;
  }
  res.json({ documents: await listAdminDocuments(bookingId) });
});

/**
 * One document's bytes.
 *
 * no-store matters more here than anywhere else in this file: the response is
 * a scan of somebody's government ID, and a cached copy on a shared machine is
 * exactly the leak the whole token design exists to prevent. The booking id is
 * part of the lookup, so a document id on its own opens nothing.
 */
router.get("/admin/guest-stays/:bookingId/documents/:documentId/file", requireAdmin, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  const bookingId = bookingIdOf(req.params.bookingId);
  const documentId = bookingIdOf(req.params.documentId);
  if (!bookingId || !documentId) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  const document = await getAdminDocument(bookingId, documentId);
  if (!document) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  // Fixed octet-stream + attachment: the uploader's MIME claim is never echoed.
  res.set(documentDownloadHeaders(document));
  res.send(document.fileData);
});

/**
 * Reject what was filed, and say so.
 *
 * Deliberately does not send the new link. The console calls this, then calls
 * the onboarding route, so the owner watches the WhatsApp message being
 * composed rather than being told one went out.
 */
router.post("/admin/guest-stays/:bookingId/reject", requireAdmin, async (req, res) => {
  const bookingId = bookingIdOf(req.params.bookingId);
  if (!bookingId) {
    res.status(400).json({ error: "Invalid booking id." });
    return;
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  const problem = rejectionReasonProblem(reason);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  // A guest number rejects only that guest's ID; without one, the whole upload.
  const slot = Number.isInteger(req.body?.slot) && req.body.slot > 0 && req.body.slot <= 8 ? (req.body.slot as number) : null;
  const result = await rejectGuestDocuments(bookingId, reason, "admin", slot);
  if (result.rejected === 0) {
    res.status(409).json({ error: "There are no documents on this booking to reject." });
    return;
  }
  res.json(result);
});

router.post("/admin/guest-stays/:bookingId/verify", requireAdmin, async (req, res) => {
  const bookingId = Array.isArray(req.params.bookingId) ? "" : req.params.bookingId;
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) {
    res.status(400).json({ error: "Invalid booking id." });
    return;
  }
  await verifyGuestDocuments(bookingId, req.body?.verified === true, "admin");
  res.json({ saved: true });
});

export default router;
