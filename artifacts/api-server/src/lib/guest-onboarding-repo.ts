import crypto from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  bookingGuests,
  bookings,
  db,
  guestDocuments,
  guestOnboarding,
  guestManagementAccess,
  guests,
  normalisePhone,
} from "@workspace/db";

import {
  MANAGEMENT_FORBIDDEN_KEYS as FORBIDDEN_KEYS,
  deadlineForIssue,
  linkExpiry,
  readinessOf,
  type Readiness,
} from "./guest-verification-rules.ts";
import {
  authoriseAdminDocument,
  authoriseManagementDocument,
  checkDocumentUpload,
  type AllowedDocumentMime,
} from "./document-security.ts";

const TOKEN_BYTES = 32;

/**
 * Recorded in guest_documents.verified_by when a document was accepted simply
 * because it arrived, rather than because a person looked at it.
 *
 * Worth keeping distinct. "verified" now means two different things depending
 * on this column — the upload completed, or the owner opened the file and was
 * satisfied — and only one of those is a human judgement. Anything that ever
 * needs to know the difference (an audit, a dispute at the door) can read it
 * here instead of having to guess.
 */
export const VERIFIED_ON_UPLOAD = "auto:on-upload";

export type GuestDocumentInput = {
  documentType: string;
  documentNumber?: string | null;
  source?: string;
  originalFilename?: string | null;
  mimeType?: string | null;
  dataBase64: string;
};

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function makeGuestOnboardingToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

export async function createOrRefreshOnboarding(bookingId: string) {
  const booking = (await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1))[0];
  if (!booking) return null;

  const token = makeGuestOnboardingToken();
  const tokenHash = hashToken(token);
  // deadlineForIssue, not verificationDeadline: re-sending a link after
  // rejecting a document must not hand the guest a deadline that has already
  // gone. See RESEND_GRACE_HOURS.
  const verification = deadlineForIssue(booking.checkIn, booking.checkOut);
  const expires = linkExpiry(booking.checkOut);

  const existing = (await db.select().from(guestOnboarding).where(eq(guestOnboarding.bookingId, bookingId)).limit(1))[0];

  if (existing) {
    // "blocked" is set when a guest tried to submit after the deadline. Since
    // this call moves the deadline forward, leaving the row blocked would hand
    // the guest a link that the submit route still refuses. Any other status
    // is left alone: re-sending a link to a guest who already filed good
    // documents must not quietly un-verify them — only an explicit rejection
    // does that.
    await db.update(guestOnboarding).set({
      tokenHash,
      expiresAt: expires,
      verificationDeadline: verification,
      ...(existing.status === "blocked" ? { status: "pending" as const, completedAt: null } : {}),
      lastSentAt: new Date(),
    }).where(eq(guestOnboarding.id, existing.id));
  } else {
    await db.insert(guestOnboarding).values({
      bookingId,
      tokenHash,
      expiresAt: expires,
      verificationDeadline: verification,
      lastSentAt: new Date(),
    });
  }

  return { token, verificationDeadline: verification, expiresAt: expires, booking };
}

/**
 * Everything management is allowed to be told about a stay.
 *
 * This type is the whitelist. It exists because the alternative — passing the
 * admin's booking row to a message builder and trusting whoever edits that
 * builder next not to interpolate a rupee figure — is a discipline problem,
 * and discipline problems come back. Here a financial field cannot be leaked
 * by accident because it is never fetched: buildManagementDto() names its
 * columns explicitly and `bookings.grossPaise`, `bookings.receivedPaise`,
 * commission and tax are not among them.
 *
 * Management gets what it needs to receive a guest at the door and nothing
 * that belongs to the owner's ledger.
 *
 * If you add a field here, it must be operational. Money is not operational.
 */
export type ManagementGuestVerificationDTO = {
  guestName: string | null;
  guestPhone: string | null;
  checkIn: string;
  checkOut: string;
  /** Per-status counts of the identity documents filed for this stay. */
  documents: {
    count: number;
    submitted: number;
    verified: number;
    rejected: number;
  };
  /** Operational readiness, derived — never the raw booking status. */
  readiness: Readiness;
  verificationDeadline: string | null;
};

/** Re-exported so callers of this repo need only one import. */
export const MANAGEMENT_FORBIDDEN_KEYS = FORBIDDEN_KEYS;

/**
 * Builds the management view of one booking, reading only whitelisted columns.
 */
export async function buildManagementDto(
  bookingId: string,
  now = new Date(),
): Promise<ManagementGuestVerificationDTO | null> {
  // Note what is NOT selected here. This is the whole security control.
  const booking = (
    await db
      .select({
        id: bookings.id,
        guestName: bookings.guestName,
        guestPhone: bookings.guestPhone,
        checkIn: bookings.checkIn,
        checkOut: bookings.checkOut,
      })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1)
  )[0];

  if (!booking) return null;

  const onboarding = (
    await db
      .select({
        status: guestOnboarding.status,
        verificationDeadline: guestOnboarding.verificationDeadline,
      })
      .from(guestOnboarding)
      .where(eq(guestOnboarding.bookingId, bookingId))
      .limit(1)
  )[0];

  const docs = await db
    .select({ status: guestDocuments.status })
    .from(guestDocuments)
    .where(and(eq(guestDocuments.bookingId, bookingId), isNull(guestDocuments.deletedAt)));

  const documents = {
    count: docs.length,
    submitted: docs.filter((d) => d.status === "submitted").length,
    verified: docs.filter((d) => d.status === "verified").length,
    rejected: docs.filter((d) => d.status === "rejected").length,
  };

  return {
    guestName: booking.guestName,
    guestPhone: booking.guestPhone,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    documents,
    readiness: readinessOf({
      onboardingStatus: onboarding?.status ?? null,
      verificationDeadline: onboarding?.verificationDeadline ?? null,
      documents,
      now,
    }),
    verificationDeadline: onboarding?.verificationDeadline?.toISOString() ?? null,
  };
}

export async function createOrRefreshManagementAccess(bookingId: string) {
  const booking = (await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1))[0];
  if (!booking) return null;

  const token = makeGuestOnboardingToken();
  const tokenHash = hashToken(token);
  // Management only needs the documents around this stay; keep the bearer link
  // short-lived beyond checkout rather than making it permanent.
  const expiresAt = new Date(`${booking.checkOut}T23:59:59+05:30`);
  expiresAt.setDate(expiresAt.getDate() + 7);

  const existing = (await db.select().from(guestManagementAccess).where(eq(guestManagementAccess.bookingId, bookingId)).limit(1))[0];
  if (existing) {
    await db.update(guestManagementAccess).set({ tokenHash, expiresAt }).where(eq(guestManagementAccess.id, existing.id));
  } else {
    await db.insert(guestManagementAccess).values({ bookingId, tokenHash, expiresAt });
  }

  return { token, expiresAt };
}

export async function findManagementAccess(token: string) {
  const hash = hashToken(token);
  const access = (await db.select().from(guestManagementAccess).where(eq(guestManagementAccess.tokenHash, hash)).limit(1))[0];
  if (!access || access.expiresAt <= new Date()) return null;
  const booking = (await db.select().from(bookings).where(eq(bookings.id, access.bookingId)).limit(1))[0];
  if (!booking || booking.status === "cancelled") return null;
  return { access, booking };
}

export async function listManagementDocuments(token: string) {
  const found = await findManagementAccess(token);
  if (!found) return null;
  const documents = await db
    .select({
      id: guestDocuments.id,
      documentType: guestDocuments.documentType,
      originalFilename: guestDocuments.originalFilename,
      mimeType: guestDocuments.mimeType,
      sizeBytes: guestDocuments.sizeBytes,
      status: guestDocuments.status,
      rejectionReason: guestDocuments.rejectionReason,
      uploadedAt: guestDocuments.uploadedAt,
    })
    .from(guestDocuments)
    .where(and(eq(guestDocuments.bookingId, found.booking.id), isNull(guestDocuments.deletedAt)))
    .orderBy(desc(guestDocuments.uploadedAt));

  return {
    booking: {
      guestName: found.booking.guestName,
      guestPhone: found.booking.guestPhone,
      checkIn: found.booking.checkIn,
      checkOut: found.booking.checkOut,
    },
    documents,
  };
}

export async function getManagementDocument(token: string, documentId: string) {
  const found = await findManagementAccess(token);
  if (!found) return null;
  // The SQL filter scopes the lookup to the link's booking; the authorise call
  // re-checks the same boundary in code, where it is unit-tested.
  const row = (await db
    .select()
    .from(guestDocuments)
    .where(and(eq(guestDocuments.id, documentId), eq(guestDocuments.bookingId, found.booking.id), isNull(guestDocuments.deletedAt)))
    .limit(1))[0];
  const document = authoriseManagementDocument(found.access, found.booking, documentId, row, new Date());
  return document ? { booking: found.booking, document } : null;
}

export async function findOnboarding(token: string) {
  const hash = hashToken(token);
  const row = (await db.select().from(guestOnboarding).where(eq(guestOnboarding.tokenHash, hash)).limit(1))[0];
  if (!row || row.expiresAt <= new Date()) return null;
  const booking = (await db.select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1))[0];
  if (!booking || booking.status === "cancelled") return null;
  return { onboarding: row, booking };
}

export async function submitGuestOnboarding(input: {
  token: string;
  fullName: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  documents: GuestDocumentInput[];
}) {
  const found = await findOnboarding(input.token);
  if (!found) return { ok: false as const, reason: "invalid_link" as const };

  const phone = normalisePhone(input.phone);
  if (!phone) return { ok: false as const, reason: "invalid_phone" as const };
  if (!input.fullName.trim()) return { ok: false as const, reason: "invalid_name" as const };
  if (!input.documents.length) return { ok: false as const, reason: "document_required" as const };
  if (new Date() >= found.onboarding.verificationDeadline) {
    await db.update(guestOnboarding).set({ status: "blocked" }).where(eq(guestOnboarding.id, found.onboarding.id));
    return { ok: false as const, reason: "deadline_passed" as const };
  }

  // Every document is checked before anything is written: MIME type is
  // mandatory and allowlisted, the bytes must match it, and size is capped.
  // See document-security.ts.
  const checked: Array<{ doc: GuestDocumentInput; bytes: Buffer; mimeType: AllowedDocumentMime }> = [];
  for (const doc of input.documents) {
    const check = checkDocumentUpload(doc);
    if (!check.ok) return { ok: false as const, reason: check.reason };
    checked.push({ doc, bytes: check.bytes, mimeType: check.mimeType });
  }

  const result = await db.transaction(async (tx) => {
    const existing = (await tx.select().from(guests).where(eq(guests.phone, phone)).orderBy(desc(guests.updatedAt)).limit(1))[0];
    const guest = existing
      ? (await tx.update(guests).set({
          fullName: input.fullName.trim(),
          email: input.email?.trim() || null,
          address: input.address?.trim() || null,
          city: input.city?.trim() || null,
          state: input.state?.trim() || null,
          country: input.country?.trim() || null,
          updatedAt: new Date(),
        }).where(eq(guests.id, existing.id)).returning())[0]
      : (await tx.insert(guests).values({
          fullName: input.fullName.trim(),
          phone,
          email: input.email?.trim() || null,
          address: input.address?.trim() || null,
          city: input.city?.trim() || null,
          state: input.state?.trim() || null,
          country: input.country?.trim() || null,
        }).returning())[0];

    if (!guest) throw new Error("Could not save guest");

    const pair = (await tx.select().from(bookingGuests).where(and(eq(bookingGuests.bookingId, found.booking.id), eq(bookingGuests.guestId, guest.id))).limit(1))[0];
    if (!pair) {
      await tx.insert(bookingGuests).values({ bookingId: found.booking.id, guestId: guest.id, isPrimary: true });
    }

    // Documents the owner already rejected are superseded by this upload.
    // Without this they would sit alongside the new ones and hold the stay
    // out of "ready" for ever, because readiness asks that EVERY live document
    // be verified. They are soft-deleted, not removed: the row, the file and
    // the rejection reason all survive for the record.
    await tx
      .update(guestDocuments)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(guestDocuments.bookingId, found.booking.id),
          eq(guestDocuments.status, "rejected"),
          isNull(guestDocuments.deletedAt),
        ),
      );

    const uploadedAt = new Date();

    for (const { doc, bytes, mimeType } of checked) {
      await tx.insert(guestDocuments).values({
        guestId: guest.id,
        bookingId: found.booking.id,
        documentType: doc.documentType.trim(),
        documentNumber: doc.documentNumber?.trim() || null,
        source: doc.source?.trim() || "upload",
        originalFilename: doc.originalFilename?.trim() || null,
        mimeType,
        sizeBytes: bytes.length,
        fileData: bytes,
        // A completed upload lands as verified rather than waiting for the
        // owner to click Verify on every stay. The owner's role here is the
        // veto: they open the documents and reject the ones that will not do,
        // which un-verifies them and asks the guest again. VERIFIED_ON_UPLOAD
        // is recorded as the verifier so a row that nobody actually looked at
        // is never mistaken for one an owner signed off by hand.
        status: "verified",
        verifiedAt: uploadedAt,
        verifiedBy: VERIFIED_ON_UPLOAD,
      });
    }

    await tx.update(guestOnboarding).set({
      status: "verified",
      completedAt: uploadedAt,
    }).where(eq(guestOnboarding.id, found.onboarding.id));

    return guest;
  });

  return { ok: true as const, guest: result };
}

export async function listAdminGuestStays() {
  const rows = await db
    .select({
      bookingId: bookings.id,
      reference: bookings.reference,
      source: bookings.source,
      createdAt: bookings.createdAt,
      guestName: bookings.guestName,
      guestPhone: bookings.guestPhone,
      checkIn: bookings.checkIn,
      checkOut: bookings.checkOut,
      guests: bookings.guests,
      pets: bookings.pets,
      status: bookings.status,
      grossPaise: bookings.grossPaise,
      receivedPaise: bookings.receivedPaise,
      onboardingStatus: guestOnboarding.status,
      verificationDeadline: guestOnboarding.verificationDeadline,
      onboardingId: guestOnboarding.id,
    })
    .from(bookings)
    .leftJoin(guestOnboarding, eq(guestOnboarding.bookingId, bookings.id))
    // Latest booking first; the admin table re-sorts on any column.
    .orderBy(desc(bookings.createdAt));

  const documents = await db
    .select({ bookingId: guestDocuments.bookingId, status: guestDocuments.status })
    .from(guestDocuments)
    .where(isNull(guestDocuments.deletedAt));

  const counts = new Map<string, { pending: number; submitted: number; verified: number; rejected: number }>();
  for (const d of documents) {
    const c = counts.get(d.bookingId) ?? { pending: 0, submitted: 0, verified: 0, rejected: 0 };
    c[d.status] += 1;
    counts.set(d.bookingId, c);
  }
  return rows.map((row) => ({ ...row, documents: counts.get(row.bookingId) ?? { pending: 0, submitted: 0, verified: 0, rejected: 0 } }));
}

/**
 * The owner's own view of the documents filed for one stay.
 *
 * Separate from listManagementDocuments even though the shape is close: that
 * one is reached with a bearer token that management holds, this one with the
 * admin session. Sharing a function between them would mean one edit could
 * widen management's access by accident, and what management may see is the
 * whole point of the management path.
 *
 * `fileData` is deliberately not selected — a list of six scans would be
 * megabytes of base64 in a JSON response nobody reads. The bytes come one at
 * a time from getAdminDocument.
 */
export async function listAdminDocuments(bookingId: string) {
  return db
    .select({
      id: guestDocuments.id,
      documentType: guestDocuments.documentType,
      documentNumber: guestDocuments.documentNumber,
      originalFilename: guestDocuments.originalFilename,
      mimeType: guestDocuments.mimeType,
      sizeBytes: guestDocuments.sizeBytes,
      status: guestDocuments.status,
      rejectionReason: guestDocuments.rejectionReason,
      uploadedAt: guestDocuments.uploadedAt,
      verifiedAt: guestDocuments.verifiedAt,
      verifiedBy: guestDocuments.verifiedBy,
    })
    .from(guestDocuments)
    .where(and(eq(guestDocuments.bookingId, bookingId), isNull(guestDocuments.deletedAt)))
    .orderBy(desc(guestDocuments.uploadedAt));
}

/** One document's bytes, scoped to its booking so an id alone is not enough. */
export async function getAdminDocument(bookingId: string, documentId: string) {
  const row =
    (await db
      .select()
      .from(guestDocuments)
      .where(
        and(
          eq(guestDocuments.id, documentId),
          eq(guestDocuments.bookingId, bookingId),
          isNull(guestDocuments.deletedAt),
        ),
      )
      .limit(1))[0] ?? null;
  return authoriseAdminDocument(bookingId, documentId, row);
}

/**
 * The owner's veto: these documents will not do, ask again.
 *
 * Un-verifies every live document for the stay, records why, and puts the
 * onboarding row back to pending so the stay stops reading as settled. It does
 * NOT send anything — issuing the new link is createOrRefreshOnboarding's job,
 * and keeping them apart means a rejection is never silently accompanied by a
 * message the owner did not see go out.
 *
 * Returns how many documents were rejected, so a caller can tell the owner
 * that something actually happened rather than reporting success on a no-op.
 */
export async function rejectGuestDocuments(
  bookingId: string,
  reason: string | null,
  admin: string,
) {
  const live = await db
    .select({ id: guestDocuments.id })
    .from(guestDocuments)
    .where(and(eq(guestDocuments.bookingId, bookingId), isNull(guestDocuments.deletedAt)));

  if (live.length === 0) return { rejected: 0 };

  await db
    .update(guestDocuments)
    .set({
      status: "rejected",
      rejectionReason: reason?.trim() || null,
      verifiedAt: new Date(),
      verifiedBy: admin,
    })
    .where(and(eq(guestDocuments.bookingId, bookingId), isNull(guestDocuments.deletedAt)));

  await db
    .update(guestOnboarding)
    .set({ status: "pending", completedAt: null })
    .where(eq(guestOnboarding.bookingId, bookingId));

  return { rejected: live.length };
}

export async function verifyGuestDocuments(bookingId: string, verified: boolean, admin: string) {
  await db.update(guestDocuments).set({
    status: verified ? "verified" : "rejected",
    verifiedAt: new Date(),
    verifiedBy: admin,
  }).where(and(eq(guestDocuments.bookingId, bookingId), isNull(guestDocuments.deletedAt)));

  await db.update(guestOnboarding).set({
    status: verified ? "verified" : "blocked",
  }).where(eq(guestOnboarding.bookingId, bookingId));
}
