import {
  boolean,
  customType,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bookings } from "./bookings";

// Drizzle 0.45.x documents PostgreSQL bytea but does not export the helper.
// Define the column type locally so this schema remains compatible with the
// version pinned by the workspace.
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const guestDocumentStatusEnum = pgEnum("guest_document_status", [
  "pending",
  "submitted",
  "verified",
  "rejected",
]);

export const guestOnboardingStatusEnum = pgEnum("guest_onboarding_status", [
  "pending",
  "submitted",
  "verified",
  "expired",
  "blocked",
]);

/** Bearer access issued separately to property management for uploaded IDs. */
export const guestManagementAccess = pgTable(
  "guest_management_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("guest_management_access_token_uniq").on(table.tokenHash),
    uniqueIndex("guest_management_access_booking_uniq").on(table.bookingId),
    index("guest_management_access_expiry_idx").on(table.expiresAt),
  ],
);

/** Canonical guest profile. Booking rows retain their original name/phone snapshot. */
export const guests = pgTable(
  "guests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    country: text("country"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("guest_phone_idx").on(table.phone)],
);

export const bookingGuests = pgTable(
  "booking_guests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    guestId: uuid("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("booking_guest_pair_uniq").on(table.bookingId, table.guestId),
    index("booking_guest_booking_idx").on(table.bookingId),
    index("booking_guest_guest_idx").on(table.guestId),
  ],
);

export const guestDocuments = pgTable(
  "guest_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guestId: uuid("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(),
    documentNumber: text("document_number"),
    source: text("source").notNull().default("upload"),
    originalFilename: text("original_filename"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    fileData: bytea("file_data"),
    externalReference: text("external_reference"),
    status: guestDocumentStatusEnum("status").notNull().default("submitted"),
    rejectionReason: text("rejection_reason"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: text("verified_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("guest_document_guest_idx").on(table.guestId),
    index("guest_document_booking_idx").on(table.bookingId),
    index("guest_document_status_idx").on(table.status),
  ],
);

export const guestOnboarding = pgTable(
  "guest_onboarding",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verificationDeadline: timestamp("verification_deadline", { withTimezone: true }).notNull(),
    status: guestOnboardingStatusEnum("status").notNull().default("pending"),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("guest_onboarding_token_uniq").on(table.tokenHash),
    uniqueIndex("guest_onboarding_booking_uniq").on(table.bookingId),
    index("guest_onboarding_expiry_idx").on(table.expiresAt),
  ],
);

export type Guest = typeof guests.$inferSelect;
export type NewGuest = typeof guests.$inferInsert;
export type GuestDocument = typeof guestDocuments.$inferSelect;
export type GuestOnboarding = typeof guestOnboarding.$inferSelect;
export type GuestManagementAccess = typeof guestManagementAccess.$inferSelect;
