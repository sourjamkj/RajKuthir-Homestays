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

const TOKEN_BYTES = 32;
const LINK_TTL_DAYS = 30;
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

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

function verificationDeadline(checkIn: string): Date {
  // Raj Kuthir check-in is 11:00 AM Asia/Kolkata. The verification deadline is
  // exactly 48 hours before that scheduled check-in time.
  const d = new Date(`${checkIn}T11:00:00+05:30`);
  d.setTime(d.getTime() - 48 * 60 * 60 * 1000);
  return d;
}

function expiry(checkOut: string): Date {
  return new Date(`${checkOut}T12:00:00+05:30`).getTime() > Date.now()
    ? new Date(`${checkOut}T12:00:00+05:30`)
    : new Date(Date.now() + LINK_TTL_DAYS * 86400000);
}

export function makeGuestOnboardingToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

export async function createOrRefreshOnboarding(bookingId: string) {
  const booking = (await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1))[0];
  if (!booking) return null;

  const token = makeGuestOnboardingToken();
  const tokenHash = hashToken(token);
  const verification = verificationDeadline(booking.checkIn);
  const expires = expiry(booking.checkOut);

  const existing = (await db.select().from(guestOnboarding).where(eq(guestOnboarding.bookingId, bookingId)).limit(1))[0];

  if (existing) {
    await db.update(guestOnboarding).set({
      tokenHash,
      expiresAt: expires,
      verificationDeadline: verification,
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
  const document = (await db
    .select()
    .from(guestDocuments)
    .where(and(eq(guestDocuments.id, documentId), eq(guestDocuments.bookingId, found.booking.id), isNull(guestDocuments.deletedAt)))
    .limit(1))[0];
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

  for (const doc of input.documents) {
    if (!doc.documentType.trim() || !doc.dataBase64) return { ok: false as const, reason: "invalid_document" as const };
    if (doc.mimeType && !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(doc.mimeType.toLowerCase())) return { ok: false as const, reason: "unsupported_document_type" as const };
    const bytes = Buffer.from(doc.dataBase64, "base64");
    if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES) return { ok: false as const, reason: "document_too_large" as const };
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

    for (const doc of input.documents) {
      const bytes = Buffer.from(doc.dataBase64, "base64");
      await tx.insert(guestDocuments).values({
        guestId: guest.id,
        bookingId: found.booking.id,
        documentType: doc.documentType.trim(),
        documentNumber: doc.documentNumber?.trim() || null,
        source: doc.source?.trim() || "upload",
        originalFilename: doc.originalFilename?.trim() || null,
        mimeType: doc.mimeType?.trim() || "application/octet-stream",
        sizeBytes: bytes.length,
        fileData: bytes,
        status: "submitted",
      });
    }

    await tx.update(guestOnboarding).set({
      status: "submitted",
      completedAt: new Date(),
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
    .orderBy(desc(bookings.checkIn));

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
