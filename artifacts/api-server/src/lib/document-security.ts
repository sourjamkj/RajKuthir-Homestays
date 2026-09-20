/**
 * Guest ID documents: what may be uploaded, how the bytes are served back, and
 * who may read them.
 *
 * Pure functions, no database, so every rule here is tested directly by
 * document-security.test.ts. guest-onboarding-repo.ts and the document routes
 * call these; they do not re-implement them.
 *
 * WHY THIS FILE EXISTS (Phase 3E)
 *
 *   1. The MIME allowlist was only applied when the uploader sent a MIME type
 *      (`if (doc.mimeType && !ALLOWED...)`), so omitting it skipped the check.
 *   2. The stored, uploader-supplied type was then echoed back as the response
 *      Content-Type with `inline` disposition. An "ID document" declared as
 *      text/html would have been rendered by the browser on our origin.
 *   3. Nothing tested that booking A's document cannot be read through
 *      booking B's link.
 */

export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

/** Unchanged from the original inline list — not broadened. */
export const ALLOWED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AllowedDocumentMime = (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number];

const EXTENSION: Record<AllowedDocumentMime, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function normaliseDocumentMime(value: unknown): AllowedDocumentMime | null {
  if (typeof value !== "string") return null;
  const mime = value.trim().toLowerCase();
  return (ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(mime)
    ? (mime as AllowedDocumentMime)
    : null;
}

/**
 * Whether the bytes are actually what the declared type says. The declared
 * type is the uploader's word; the first few bytes are not. A file that
 * claims to be a PNG and starts with `<html>` is refused.
 */
export function bytesMatchMime(bytes: Uint8Array, mime: AllowedDocumentMime): boolean {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  switch (mime) {
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/webp":
      return starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    case "application/pdf": {
      // The PDF spec lets "%PDF-" appear anywhere in the first 1024 bytes.
      const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
      return head.includes("%PDF-");
    }
  }
}

export type DocumentUploadCheck =
  | { ok: true; mimeType: AllowedDocumentMime; bytes: Buffer }
  | { ok: false; reason: "invalid_document" | "unsupported_document_type" | "document_too_large" };

/**
 * The one gate every uploaded document passes through. MIME type is
 * mandatory: missing, empty or unlisted is refused, and so are bytes that do
 * not match the type they claim.
 */
export function checkDocumentUpload(doc: {
  documentType?: string | null;
  mimeType?: unknown;
  dataBase64?: unknown;
}): DocumentUploadCheck {
  if (!doc.documentType?.trim() || typeof doc.dataBase64 !== "string" || !doc.dataBase64) {
    return { ok: false, reason: "invalid_document" };
  }
  const mimeType = normaliseDocumentMime(doc.mimeType);
  if (!mimeType) return { ok: false, reason: "unsupported_document_type" };

  // Cheap pre-check before decoding: base64 is 4 chars per 3 bytes.
  if (Math.floor((doc.dataBase64.length * 3) / 4) > MAX_DOCUMENT_BYTES + 3) {
    return { ok: false, reason: "document_too_large" };
  }
  const bytes = Buffer.from(doc.dataBase64, "base64");
  if (!bytes.length) return { ok: false, reason: "invalid_document" };
  if (bytes.length > MAX_DOCUMENT_BYTES) return { ok: false, reason: "document_too_large" };
  if (!bytesMatchMime(bytes, mimeType)) return { ok: false, reason: "unsupported_document_type" };

  return { ok: true, mimeType, bytes };
}

/**
 * Response headers for serving a stored document, admin and management alike.
 *
 * The Content-Type is FIXED. Whatever the row says, the browser is told these
 * are opaque bytes to be saved, never a page to render, and nosniff stops it
 * guessing otherwise. The stored type is used only to pick a sensible file
 * extension, and only if it is one we allow.
 */
export function documentDownloadHeaders(document: {
  originalFilename: string | null;
  mimeType: string | null;
}): Record<string, string> {
  const base =
    (document.originalFilename ?? "")
      .replace(/\.[^.]*$/, "")
      .replace(/[^a-zA-Z0-9._ -]/g, "_")
      .trim()
      .slice(0, 120) || "guest-document";
  const mime = normaliseDocumentMime(document.mimeType);
  const filename = mime ? `${base}.${EXTENSION[mime]}` : base;

  return {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
  };
}

type DocumentRow = { id: string; bookingId: string; deletedAt: Date | null };

/**
 * Admin path: the booking id in the URL must own the document. A document id
 * alone, or with some other booking's id, opens nothing.
 */
export function authoriseAdminDocument<T extends DocumentRow>(
  bookingId: string,
  documentId: string,
  document: T | null | undefined,
): T | null {
  if (!document) return null;
  if (document.id !== documentId) return null;
  if (document.bookingId !== bookingId) return null;
  if (document.deletedAt) return null;
  return document;
}

/**
 * Management path: a bearer link is issued for ONE booking. It must be live,
 * that booking must still stand, and the document must belong to it.
 */
export function authoriseManagementDocument<T extends DocumentRow>(
  access: { bookingId: string; expiresAt: Date } | null | undefined,
  booking: { id: string; status: string } | null | undefined,
  documentId: string,
  document: T | null | undefined,
  now: Date,
): T | null {
  if (!access || access.expiresAt.getTime() <= now.getTime()) return null;
  if (!booking || booking.id !== access.bookingId || booking.status === "cancelled") return null;
  return authoriseAdminDocument(access.bookingId, documentId, document);
}
