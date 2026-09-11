import {
  pgTable,
  boolean,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Mailboxes the server reads OTA booking emails from.
 *
 * One row per mailbox rather than a single set of environment variables,
 * because the channels do not all send to the same address — a Gmail account
 * and a Yahoo account can both be live at once, and a fourth channel added
 * next year should not need a redeploy.
 *
 * THE PASSWORD COLUMN IS CIPHERTEXT, never a password. It is sealed by
 * secret-box.ts with a key that lives only in the environment, so a database
 * dump on its own does not hand anyone a mailbox. Use an app-specific
 * password (Gmail and Yahoo both issue them) and never the account password:
 * an app password can be revoked on its own without locking the owner out.
 */
export const mailAccounts = pgTable(
  "mail_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** What the owner calls it: "Gmail — bookings", "Yahoo — old MMT". */
    label: text("label").notNull(),

    host: text("host").notNull(),
    port: integer("port").notNull().default(993),
    /** Implicit TLS. Effectively always true; false is for a local test server. */
    secure: boolean("secure").notNull().default(true),

    username: text("username").notNull(),
    /** Sealed by secret-box.ts. Never a plaintext password, never logged. */
    passwordCipher: text("password_cipher").notNull(),

    folder: text("folder").notNull().default("INBOX"),

    /**
     * Highest message UID already read from this folder.
     *
     * IMAP UIDs only increase, and only mean anything alongside the folder's
     * UIDVALIDITY: if the server reports a different UIDVALIDITY the old
     * numbers refer to nothing, and the sync must start again from zero
     * rather than silently skip every message. Hence both columns.
     */
    lastSeenUid: integer("last_seen_uid").notNull().default(0),
    uidValidity: text("uid_validity"),

    enabled: boolean("enabled").notNull().default(true),

    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    /** Human-readable reason the last run failed, or null when it worked. */
    lastError: text("last_error"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mail_account_mailbox_idx").on(
      table.host,
      table.username,
      table.folder,
    ),
    index("mail_account_enabled_idx").on(table.enabled),
  ],
);

export type MailAccount = typeof mailAccounts.$inferSelect;
export type NewMailAccount = typeof mailAccounts.$inferInsert;
