import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  db,
  bookings,
  enquiries,
  guestContacts,
  normalisePhone,
  type Enquiry,
} from "@workspace/db";

export type EnquiryStatus = Enquiry["status"];

export async function createEnquiry(input: {
  name: string;
  phone: string;
  email?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  adults?: number | null;
  children?: number | null;
  pets?: number | null;
  requests?: string | null;
}): Promise<Enquiry> {
  const [created] = await db.insert(enquiries).values(input).returning();
  return created!;
}

export async function listEnquiries(limit = 200): Promise<Enquiry[]> {
  return db
    .select()
    .from(enquiries)
    .orderBy(desc(enquiries.createdAt))
    .limit(limit);
}

export async function setEnquiryStatus(
  id: string,
  status: EnquiryStatus,
): Promise<Enquiry | null> {
  const [updated] = await db
    .update(enquiries)
    .set({ status })
    .where(eq(enquiries.id, id))
    .returning();

  return updated ?? null;
}

export async function deleteEnquiry(id: string): Promise<boolean> {
  const deleted = await db
    .delete(enquiries)
    .where(eq(enquiries.id, id))
    .returning({ id: enquiries.id });

  return deleted.length > 0;
}

/** How many enquiries arrived in the last N days — a crude demand pulse. */
export async function countRecentEnquiries(days = 30): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(enquiries)
    .where(gte(enquiries.createdAt, since));

  return row?.count ?? 0;
}

export type Contact = {
  phone: string;
  name: string | null;
  email: string | null;
  stays: number;
  enquiryCount: number;
  lastStay: string | null;
  lastEnquiry: string | null;
  totalSpentPaise: number;
  marketingOptOut: boolean;
  note: string | null;
  tags: string | null;
};

/**
 * The guest contact list, built by folding bookings and enquiries together on
 * a normalised phone number.
 *
 * Derived rather than stored: names and stay history already live in those
 * tables, and a second copy would drift. Only opt-out state, notes and tags
 * are persisted, in `guest_contacts`.
 */
export async function listContacts(): Promise<Contact[]> {
  const [bookingRows, enquiryRows, contactRows] = await Promise.all([
    db
      .select({
        phone: bookings.guestPhone,
        name: bookings.guestName,
        checkIn: bookings.checkIn,
        gross: bookings.grossPaise,
        status: bookings.status,
      })
      .from(bookings),
    db
      .select({
        phone: enquiries.phone,
        name: enquiries.name,
        email: enquiries.email,
        createdAt: enquiries.createdAt,
      })
      .from(enquiries),
    db.select().from(guestContacts),
  ]);

  const byPhone = new Map<string, Contact>();

  const ensure = (phone: string): Contact => {
    const existing = byPhone.get(phone);
    if (existing) return existing;

    const fresh: Contact = {
      phone,
      name: null,
      email: null,
      stays: 0,
      enquiryCount: 0,
      lastStay: null,
      lastEnquiry: null,
      totalSpentPaise: 0,
      marketingOptOut: false,
      note: null,
      tags: null,
    };
    byPhone.set(phone, fresh);
    return fresh;
  };

  for (const row of bookingRows) {
    const phone = normalisePhone(row.phone);
    if (!phone) continue;

    const contact = ensure(phone);
    contact.name ??= row.name;

    // Cancelled stays still identify the person, but never count as revenue.
    if (row.status !== "cancelled") {
      contact.stays += 1;
      contact.totalSpentPaise += row.gross ?? 0;
      if (!contact.lastStay || row.checkIn > contact.lastStay) {
        contact.lastStay = row.checkIn;
      }
    }
  }

  for (const row of enquiryRows) {
    const phone = normalisePhone(row.phone);
    if (!phone) continue;

    const contact = ensure(phone);
    contact.name ??= row.name;
    contact.email ??= row.email;
    contact.enquiryCount += 1;

    const iso = row.createdAt.toISOString().slice(0, 10);
    if (!contact.lastEnquiry || iso > contact.lastEnquiry) {
      contact.lastEnquiry = iso;
    }
  }

  for (const row of contactRows) {
    const contact = byPhone.get(row.phone);
    if (!contact) continue;
    contact.marketingOptOut = row.marketingOptOut;
    contact.note = row.note;
    contact.tags = row.tags;
  }

  return [...byPhone.values()].sort((left, right) =>
    (right.lastStay ?? right.lastEnquiry ?? "").localeCompare(
      left.lastStay ?? left.lastEnquiry ?? "",
    ),
  );
}

export async function updateContact(
  phone: string,
  patch: {
    marketingOptOut?: boolean;
    note?: string | null;
    tags?: string | null;
  },
): Promise<void> {
  const normalised = normalisePhone(phone);
  if (!normalised) return;

  await db
    .insert(guestContacts)
    .values({
      phone: normalised,
      marketingOptOut: patch.marketingOptOut ?? false,
      note: patch.note ?? null,
      tags: patch.tags ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: guestContacts.phone,
      set: {
        ...(patch.marketingOptOut !== undefined
          ? { marketingOptOut: patch.marketingOptOut }
          : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        updatedAt: new Date(),
      },
    });
}
