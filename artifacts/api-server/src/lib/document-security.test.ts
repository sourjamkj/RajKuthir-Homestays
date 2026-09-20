import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MAX_DOCUMENT_BYTES,
  authoriseAdminDocument,
  authoriseManagementDocument,
  checkDocumentUpload,
  documentDownloadHeaders,
} from "./document-security.ts";

/**
 * Phase 3E: guest ID document upload validation, safe serving, and the
 * booking boundary on both read paths.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(here, rel), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n", "latin1");
const HTML = Buffer.from("<html><script>alert(document.cookie)</script></html>", "utf8");
const b64 = (bytes: Buffer) => bytes.toString("base64");
const upload = (mimeType: unknown, bytes: Buffer = PNG) => ({ documentType: "Aadhaar", mimeType, dataBase64: b64(bytes) });

/* ------------------------------------------------------------ uploads */

test("upload · an allowed MIME type with matching bytes is accepted", () => {
  for (const [mime, bytes] of [["image/png", PNG], ["image/jpeg", JPEG], ["application/pdf", PDF], ["IMAGE/PNG ", PNG]] as const) {
    const result = checkDocumentUpload(upload(mime, bytes));
    assert.equal(result.ok, true, `${mime} was refused`);
    if (result.ok) assert.equal(result.bytes.length, bytes.length);
  }
});

test("upload · a missing MIME type is rejected", () => {
  const result = checkDocumentUpload({ documentType: "Aadhaar", dataBase64: b64(PNG) });
  assert.deepEqual(result, { ok: false, reason: "unsupported_document_type" });
  assert.deepEqual(checkDocumentUpload(upload(null)), { ok: false, reason: "unsupported_document_type" });
});

test("upload · an empty MIME type is rejected", () => {
  assert.deepEqual(checkDocumentUpload(upload("")), { ok: false, reason: "unsupported_document_type" });
  assert.deepEqual(checkDocumentUpload(upload("   ")), { ok: false, reason: "unsupported_document_type" });
});

test("upload · an unsupported MIME type is rejected", () => {
  for (const mime of ["text/html", "image/svg+xml", "application/xhtml+xml", "application/octet-stream", "image/gif", "text/plain"]) {
    assert.deepEqual(checkDocumentUpload(upload(mime, HTML)), { ok: false, reason: "unsupported_document_type" }, mime);
  }
});

test("upload · bytes that do not match the declared type are rejected", () => {
  assert.deepEqual(checkDocumentUpload(upload("image/png", HTML)), { ok: false, reason: "unsupported_document_type" });
  assert.deepEqual(checkDocumentUpload(upload("application/pdf", HTML)), { ok: false, reason: "unsupported_document_type" });
  assert.deepEqual(checkDocumentUpload(upload("image/jpeg", PNG)), { ok: false, reason: "unsupported_document_type" });
});

test("upload · an oversized file is rejected", () => {
  const big = Buffer.alloc(MAX_DOCUMENT_BYTES + 1);
  PNG.copy(big);
  assert.deepEqual(checkDocumentUpload(upload("image/png", big)), { ok: false, reason: "document_too_large" });

  const atLimit = Buffer.alloc(MAX_DOCUMENT_BYTES);
  PNG.copy(atLimit);
  assert.equal(checkDocumentUpload(upload("image/png", atLimit)).ok, true, "a file exactly at the limit is refused");
});

test("upload · missing data or type is rejected", () => {
  assert.deepEqual(checkDocumentUpload({ documentType: "Aadhaar", mimeType: "image/png", dataBase64: "" }), { ok: false, reason: "invalid_document" });
  assert.deepEqual(checkDocumentUpload({ documentType: " ", mimeType: "image/png", dataBase64: b64(PNG) }), { ok: false, reason: "invalid_document" });
});

test("upload · the submit path uses the mandatory check, not the old conditional one", () => {
  const repo = strip(read("./guest-onboarding-repo.ts"));
  const submit = repo.slice(repo.indexOf("export async function submitGuestOnboarding"));
  assert.match(submit, /checkDocumentUpload\(doc\)/);
  assert.doesNotMatch(repo, /if \(doc\.mimeType &&/, "the skippable MIME check is back");
  assert.doesNotMatch(repo, /application\/octet-stream/, "an unknown type can still be stored");
  // Validation happens before the transaction that writes anything.
  assert.ok(submit.indexOf("checkDocumentUpload") < submit.indexOf("db.transaction"));
});

/* ------------------------------------------------------------ serving */

test("serving · the response type is fixed, whatever the stored MIME says", () => {
  for (const stored of ["text/html", "image/svg+xml", "image/png", null, "application/pdf"]) {
    const headers = documentDownloadHeaders({ originalFilename: "id.html", mimeType: stored });
    assert.equal(headers["Content-Type"], "application/octet-stream", String(stored));
    assert.match(headers["Content-Disposition"], /^attachment; /);
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
  }
});

test("serving · the filename cannot break out of the header or keep a dangerous extension", () => {
  const h = documentDownloadHeaders({ originalFilename: 'a"; x=<script>.html', mimeType: "text/html" });
  assert.doesNotMatch(h["Content-Disposition"].slice('attachment; filename="'.length, -1), /["<>;]/);
  assert.doesNotMatch(h["Content-Disposition"], /\.html"/);
  assert.equal(documentDownloadHeaders({ originalFilename: "scan.jpeg", mimeType: "image/jpeg" })["Content-Disposition"], 'attachment; filename="scan.jpg"');
  assert.equal(documentDownloadHeaders({ originalFilename: null, mimeType: null })["Content-Disposition"], 'attachment; filename="guest-document"');
});

test("serving · both document routes use the fixed headers and never echo the stored type", () => {
  const routes = strip(read("../routes/guest-onboarding.ts"));
  assert.doesNotMatch(routes, /res\.type\(/, "a route sets its type from data again");
  assert.doesNotMatch(routes, /inline; filename/, "a route renders documents inline again");
  const management = routes.slice(routes.indexOf('"/management/documents/file"'));
  const admin = routes.slice(routes.indexOf('"/admin/guest-stays/:bookingId/documents/:documentId/file"'));
  assert.match(management.slice(0, 900), /res\.set\(documentDownloadHeaders\(result\.document\)\)/);
  assert.match(admin.slice(0, 900), /res\.set\(documentDownloadHeaders\(document\)\)/);
  assert.match(admin.slice(0, 200), /requireAdmin/, "the admin file route lost its guard");
});

/* ------------------------------------------------------- authorisation */

const NOW = new Date("2026-09-20T10:00:00Z");
const LATER = new Date("2026-10-01T00:00:00Z");
const BOOKING_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOOKING_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DOC_A = { id: "11111111-1111-4111-8111-111111111111", bookingId: BOOKING_A, deletedAt: null };

test("auth · admin: booking A's document through booking B's URL is denied", () => {
  assert.equal(authoriseAdminDocument(BOOKING_B, DOC_A.id, DOC_A), null);
});

test("auth · admin: the owning booking can read it; deleted or mismatched ids cannot", () => {
  assert.equal(authoriseAdminDocument(BOOKING_A, DOC_A.id, DOC_A), DOC_A);
  assert.equal(authoriseAdminDocument(BOOKING_A, "22222222-2222-4222-8222-222222222222", DOC_A), null);
  assert.equal(authoriseAdminDocument(BOOKING_A, DOC_A.id, { ...DOC_A, deletedAt: NOW }), null);
  assert.equal(authoriseAdminDocument(BOOKING_A, DOC_A.id, null), null);
});

test("auth · management: booking B's link cannot open booking A's document", () => {
  const accessB = { bookingId: BOOKING_B, expiresAt: LATER };
  const bookingB = { id: BOOKING_B, status: "confirmed" };
  assert.equal(authoriseManagementDocument(accessB, bookingB, DOC_A.id, DOC_A, NOW), null);
});

test("auth · management: a link paired with some other booking row is denied", () => {
  const accessB = { bookingId: BOOKING_B, expiresAt: LATER };
  assert.equal(authoriseManagementDocument(accessB, { id: BOOKING_A, status: "confirmed" }, DOC_A.id, DOC_A, NOW), null);
});

test("auth · management: the right link works until it expires or the stay is cancelled", () => {
  const accessA = { bookingId: BOOKING_A, expiresAt: LATER };
  const bookingA = { id: BOOKING_A, status: "confirmed" };
  assert.equal(authoriseManagementDocument(accessA, bookingA, DOC_A.id, DOC_A, NOW), DOC_A);
  assert.equal(authoriseManagementDocument({ ...accessA, expiresAt: NOW }, bookingA, DOC_A.id, DOC_A, NOW), null);
  assert.equal(authoriseManagementDocument(accessA, { ...bookingA, status: "cancelled" }, DOC_A.id, DOC_A, NOW), null);
  assert.equal(authoriseManagementDocument(null, bookingA, DOC_A.id, DOC_A, NOW), null);
});

test("auth · both repo read paths go through the booking-scoped check", () => {
  const repo = strip(read("./guest-onboarding-repo.ts"));
  const admin = repo.slice(repo.indexOf("export async function getAdminDocument"));
  const management = repo.slice(repo.indexOf("export async function getManagementDocument"));
  assert.match(admin.slice(0, 700), /eq\(guestDocuments\.bookingId, bookingId\)/);
  assert.match(admin.slice(0, 700), /authoriseAdminDocument\(bookingId, documentId, row\)/);
  assert.match(management.slice(0, 900), /eq\(guestDocuments\.bookingId, found\.booking\.id\)/);
  assert.match(management.slice(0, 900), /authoriseManagementDocument\(found\.access, found\.booking, documentId, row, new Date\(\)\)/);
});

test("auth · guests have no document read path at all", () => {
  const routes = strip(read("../routes/guest-onboarding.ts"));
  const guestRoutes = routes.match(/router\.\w+\("\/guest\/[^"]*"/g) ?? [];
  assert.deepEqual(guestRoutes.sort(), ['router.post("/guest/onboarding/lookup"', 'router.post("/guest/onboarding/submit"']);
  const lookup = routes.slice(routes.indexOf('"/guest/onboarding/lookup"'), routes.indexOf('"/guest/onboarding/submit"'));
  assert.doesNotMatch(lookup, /document|fileData/i, "the guest lookup started returning documents");
  // A guest's token can only ever write to its own booking.
  const repo = strip(read("./guest-onboarding-repo.ts"));
  const submit = repo.slice(repo.indexOf("export async function submitGuestOnboarding"));
  assert.match(submit, /bookingId: found\.booking\.id/);
  assert.doesNotMatch(submit, /bookingId: input\./);
});

test("auth · management document responses carry no financial fields", () => {
  const repo = strip(read("./guest-onboarding-repo.ts"));
  const list = repo.slice(repo.indexOf("export async function listManagementDocuments"), repo.indexOf("export async function getManagementDocument"));
  assert.doesNotMatch(list, /Paise|gross|received|commission|tax|amount|price/i);
});

/* ------------------------------------------------------- Google Maps */

const CANONICAL_MAPS = "https://maps.app.goo.gl/aEdaJaaeEy1DZ8Ps8?g_st=ac";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === "dist") return [];
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

test("maps · the stale Maps link is gone and every guest-facing copy uses the canonical one", () => {
  const roots = [path.resolve(here, ".."), path.resolve(here, "../../../raj-kuthir/src")];
  const offenders = roots.flatMap(sourceFiles).filter((f) => !f.endsWith("document-security.test.ts") && readFileSync(f, "utf8").includes("D1tUUb3JfpVdcHwu5"));
  assert.deepEqual(offenders, []);
  assert.ok(read("./whatsapp-templates.ts").includes(`mapsUrl: "${CANONICAL_MAPS}"`));
  assert.ok(read("../../../raj-kuthir/src/lib/site.ts").includes(`mapsUrl: '${CANONICAL_MAPS}'`));
  assert.ok(read("./seo.ts").includes(`"${CANONICAL_MAPS}"`));
  assert.ok(read("../../../raj-kuthir/src/pages/AdminGuests.tsx").includes(CANONICAL_MAPS));
});
