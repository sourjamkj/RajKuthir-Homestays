import crypto from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
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
import { whatsappReadyPhone } from "./phone-format.ts";
import { documentLabel, partyProblem, MAX_FILES_PER_SUBMIT, type GuestSlotInput, type IdTypeKey } from "./guest-id-rules.ts";
import { ensureGuestDocumentSlots, slotsForBooking, documentIdsForSlot, listedGuestCounts } from "./guest-id-slots.ts";

const TOKEN_BYTES = 32;

/**
 * Channels that hide the guest's real number behind a relay or leave it out.
 * A message sent to that number goes to the OTA, not to the guest.
 */
const OTA_SOURCES = new Set(["bookingCom", "airbnb", "makeMyTrip"]);


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
  /**
   * One card per guest (guest-id-rules.ts). When present it replaces
   * `documents`: every file is labelled with its guest and side, the party
   * must cover the booking, and each file gets a slot row.
   */
  party?: Array<Omit<GuestSlotInput, "files"> & { files: Array<GuestDocumentInput & { side: string }> }>;
}) {
  const found = await findOnboarding(input.token);
  type Meta = { slot: number; name: string; age: string; idType: string; side: string };
  const meta: Meta[] = [];
  if (input.party) {
    input.documents = [];
    for (const g of input.party) {
      for (const f of g.files) {
        input.documents.push({ ...f, documentType: documentLabel(g.slot, g.idType as IdTypeKey, f.side, g.name) });
        meta.push({ slot: g.slot, name: g.name.trim(), age: g.age, idType: g.idType, side: f.side });
      }
    }
  }
  if (!found) return { ok: false as const, reason: "invalid_link" as const };

  const phone = normalisePhone(input.phone);
  if (!phone) return { ok: false as const, reason: "invalid_phone" as const };
  if (!input.fullName.trim()) return { ok: false as const, reason: "invalid_name" as const };
  if (!input.documents.length) return { ok: false as const, reason: "document_required" as string };
  if (new Date() >= found.onboarding.verificationDeadline) {
    await db.update(guestOnboarding).set({ status: "blocked" }).where(eq(guestOnboarding.id, found.onboarding.id));
    return { ok: false as const, reason: "deadline_passed" as string };
  }

  if (input.party) {
    if (input.documents.length > MAX_FILES_PER_SUBMIT) return { ok: false as const, reason: "Too many files in one upload." as string };
    if (!(await ensureGuestDocumentSlots())) return { ok: false as const, reason: "Uploads are unavailable for a moment. Please try again." as string };
    // Guests whose IDs were accepted stay as they are; a re-upload only fills
    // the guests that were rejected or missing.
    const existing = await slotsForBooking(found.booking.id);
    const keptSlots = [...new Set(existing.filter((row) => row.status !== "rejected").map((row) => row.slot))];
    const problem = partyProblem({
      booked: found.booking.guests ?? 1,
      keptSlots,
      slots: input.party.map((g) => ({ ...g, files: g.files.map((f) => ({ side: f.side })) })),
    });
    if (problem) return { ok: false as const, reason: problem as string };
  }

  // Every document is checked before anything is written: MIME type is
  // mandatory and allowlisted, the bytes must match it, and size is capped.
  // See document-security.ts.
  const checked: Array<{ doc: GuestDocumentInput; bytes: Buffer; mimeType: AllowedDocumentMime }> = [];
  for (const doc of input.documents) {
    const check = checkDocumentUpload(doc);
    if (!check.ok) return { ok: false as const, reason: check.reason as string };
    checked.push({ doc, bytes: check.bytes, mimeType: check.mimeType });
  }

  // The same file twice (front used as back, or one ID for two guests).
  const seenFiles = new Map<string, string>();
  for (const { doc, bytes } of checked) {
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    const first = seenFiles.get(digest);
    if (first) return { ok: false as const, reason: `The same file was uploaded twice (${first} and ${doc.documentType}).` as string };
    seenFiles.set(digest, doc.documentType);
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

    // Put the guest's own number on the booking when the booking cannot reach
    // them: an OTA booking carries the channel's relay number (or none), and
    // every WhatsApp action, the scheduled messages and the arrival-pack phone
    // check all read bookings.guest_phone. The guest typed this number
    // themselves through their private link, so it is the best one we have.
    // A direct booking keeps the number it was made with. The number it
    // replaces is kept in the note.
    const reachable = whatsappReadyPhone(input.phone);
    const bookingPhone = normalisePhone(found.booking.guestPhone);
    if (
      reachable &&
      bookingPhone !== phone &&
      (OTA_SOURCES.has(found.booking.source) || bookingPhone === null)
    ) {
      const was = found.booking.guestPhone ?? "none";
      await tx
        .update(bookings)
        .set({
          guestPhone: reachable,
          note: sql`concat_ws(' | ', ${bookings.note}, ${`Phone from pre-arrival form; booking had ${was}`}::text)`,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, found.booking.id));
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

    // A grouped upload also supersedes any earlier ungrouped one, so the stay
    // is judged on one ID per guest and nothing else.
    if (input.party) {
      await tx
        .update(guestDocuments)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(guestDocuments.bookingId, found.booking.id),
            isNull(guestDocuments.deletedAt),
            sql`${guestDocuments.id} NOT IN (SELECT document_id FROM guest_document_slots)`,
          ),
        );
    }

    const uploadedAt = new Date();

    for (const [index, { doc, bytes, mimeType }] of checked.entries()) {
      const [inserted] = await tx.insert(guestDocuments).values({
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
      }).returning({ id: guestDocuments.id });
      const slot = meta[index];
      if (slot && inserted) {
        await tx.execute(sql`
          INSERT INTO guest_document_slots (document_id, booking_id, slot, guest_name, guest_age, id_type, side)
          VALUES (${inserted.id}, ${found.booking.id}, ${slot.slot}, ${slot.name}, ${slot.age}, ${slot.idType}, ${slot.side})`);
      }
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
  // Guests named on the uploaded IDs, to set against the booked count.
  const listed = await listedGuestCounts();
  return rows.map((row) => ({
    ...row,
    guestsListed: listed.get(row.bookingId) ?? null,
    documents: counts.get(row.bookingId) ?? { pending: 0, submitted: 0, verified: 0, rejected: 0 },
  }));
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
  const [rows, slots] = await Promise.all([listAdminDocumentRows(bookingId), slotsForBooking(bookingId)]);
  const bySlot = new Map(slots.map((row) => [row.documentId, row]));
  // Which guest and side each file is, for the per-guest review. Null for an
  // earlier upload made before IDs were grouped by guest.
  return rows.map((row) => {
    const s = bySlot.get(row.id);
    return { ...row, guest: s ? { slot: s.slot, name: s.guestName, age: s.guestAge, idType: s.idType, side: s.side } : null };
  });
}

function listAdminDocumentRows(bookingId: string) {
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
  slot?: number | null,
) {
  // One guest's ID only, when a guest is named; the rest stay as they are.
  const onlyIds = slot ? await documentIdsForSlot(bookingId, slot) : null;
  if (onlyIds && onlyIds.length === 0) return { rejected: 0 };
  const scope = onlyIds
    ? and(eq(guestDocuments.bookingId, bookingId), isNull(guestDocuments.deletedAt), sql`${guestDocuments.id} = ANY(${`{${onlyIds.join(",")}}`}::uuid[])`)
    : and(eq(guestDocuments.bookingId, bookingId), isNull(guestDocuments.deletedAt));

  const live = await db.select({ id: guestDocuments.id }).from(guestDocuments).where(scope);

  if (live.length === 0) return { rejected: 0 };

  await db
    .update(guestDocuments)
    .set({
      status: "rejected",
      rejectionReason: reason?.trim() || null,
      verifiedAt: new Date(),
      verifiedBy: admin,
    })
    .where(scope);

  await db
    .update(guestOnboarding)
    .set({ status: "pending", completedAt: null })
    .where(eq(guestOnboarding.bookingId, bookingId));

  return { rejected: live.length };
}

/** The reason on the documents currently rejected for a booking, or null. */
/**
 * What the pre-arrival page needs to show one card per guest: the booked
 * count, guests already accepted (locked), guests rejected with the reason,
 * and the rates for any extra guest.
 */
export async function partyForPage(bookingId: string) {
  const rows = await slotsForBooking(bookingId);
  const bySlot = new Map<number, { slot: number; name: string; age: string; idType: string; rejected: boolean; reason: string | null }>();
  for (const row of rows) {
    const cur = bySlot.get(row.slot) ?? { slot: row.slot, name: row.guestName, age: row.guestAge, idType: row.idType, rejected: false, reason: null };
    if (row.status === "rejected") { cur.rejected = true; cur.reason = cur.reason ?? row.rejectionReason; }
    bySlot.set(row.slot, cur);
  }
  const all = [...bySlot.values()].sort((a, b) => a.slot - b.slot);
  return {
    accepted: all.filter((g) => !g.rejected).map(({ slot, name, age, idType }) => ({ slot, name, age, idType })),
    rejected: all.filter((g) => g.rejected).map(({ slot, name, age, idType, reason }) => ({ slot, name, age, idType, reason })),
  };
}

export async function currentRejection(bookingId: string): Promise<{ reason: string | null } | null> {
  const row = (
    await db
      .select({ reason: guestDocuments.rejectionReason })
      .from(guestDocuments)
      .where(
        and(
          eq(guestDocuments.bookingId, bookingId),
          eq(guestDocuments.status, "rejected"),
          isNull(guestDocuments.deletedAt),
        ),
      )
      .orderBy(desc(guestDocuments.verifiedAt))
      .limit(1)
  )[0];
  return row ? { reason: row.reason } : null;
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
