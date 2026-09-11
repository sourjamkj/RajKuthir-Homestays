import { asc, eq } from "drizzle-orm";
import { db, mailAccounts, type MailAccount } from "@workspace/db";

import { open, seal } from "./secret-box";
import type { AccountProgress, SyncableAccount } from "./mail-sync";

/**
 * Storage for the mailboxes the server reads booking emails from.
 *
 * The password column is ciphertext at rest and plaintext for exactly as long
 * as one IMAP connection takes. Nothing in this file returns it: `listForSync`
 * opens it for the engine, and `listAccounts` — the one the admin screen uses
 * — never does. That separation is the whole point of the file.
 */

/** Safe to send to the browser. Deliberately has no password field at all. */
export type MailAccountView = {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  folder: string;
  enabled: boolean;
  lastSeenUid: number;
  lastCheckedAt: string | null;
  lastError: string | null;
};

function toView(row: MailAccount): MailAccountView {
  return {
    id: row.id,
    label: row.label,
    host: row.host,
    port: row.port,
    secure: row.secure,
    username: row.username,
    folder: row.folder,
    enabled: row.enabled,
    lastSeenUid: row.lastSeenUid,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastError: row.lastError,
  };
}

export async function listAccounts(): Promise<MailAccountView[]> {
  const rows = await db
    .select()
    .from(mailAccounts)
    .orderBy(asc(mailAccounts.label));

  return rows.map(toView);
}

/**
 * The enabled mailboxes, with their passwords opened, for the sync engine.
 *
 * A row whose password cannot be opened — a rotated key, a corrupted value —
 * is skipped rather than thrown, so one bad row cannot stop the other
 * mailboxes from being read. The reason is written to `lastError` where the
 * owner will actually see it.
 */
export async function listForSync(): Promise<SyncableAccount[]> {
  const rows = await db
    .select()
    .from(mailAccounts)
    .where(eq(mailAccounts.enabled, true))
    .orderBy(asc(mailAccounts.label));

  const usable: SyncableAccount[] = [];

  for (const row of rows) {
    let password: string;
    try {
      password = open(row.passwordCipher);
    } catch (error) {
      await saveProgress(row.id, {
        uidValidity: row.uidValidity,
        lastSeenUid: row.lastSeenUid,
        lastError:
          error instanceof Error
            ? `Stored password could not be opened: ${error.message}`
            : "Stored password could not be opened.",
        checkedAt: new Date(),
      });
      continue;
    }

    usable.push({
      id: row.id,
      label: row.label,
      host: row.host,
      port: row.port,
      secure: row.secure,
      username: row.username,
      password,
      folder: row.folder,
      lastSeenUid: row.lastSeenUid,
      uidValidity: row.uidValidity,
    });
  }

  return usable;
}

export async function createAccount(input: {
  label: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  folder: string;
}): Promise<MailAccountView> {
  const [created] = await db
    .insert(mailAccounts)
    .values({
      label: input.label,
      host: input.host,
      port: input.port,
      secure: input.secure,
      username: input.username,
      passwordCipher: seal(input.password),
      folder: input.folder,
      updatedAt: new Date(),
    })
    .returning();

  return toView(created!);
}

/**
 * Updates a mailbox. The password is only touched when a new one is supplied
 * — an admin form that posts back a blank password field must not wipe the
 * stored one, which is the classic way these screens break.
 */
export async function updateAccount(
  id: string,
  patch: Partial<{
    label: string;
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
    folder: string;
    enabled: boolean;
  }>,
): Promise<MailAccountView | null> {
  const values: Record<string, unknown> = { updatedAt: new Date() };

  for (const field of ["label", "host", "port", "secure", "username", "folder", "enabled"] as const) {
    if (patch[field] !== undefined) values[field] = patch[field];
  }

  if (patch.password) {
    values.passwordCipher = seal(patch.password);
    // A new password means the old failure is no longer the current truth.
    values.lastError = null;
  }

  const [updated] = await db
    .update(mailAccounts)
    .set(values)
    .where(eq(mailAccounts.id, id))
    .returning();

  return updated ? toView(updated) : null;
}

export async function deleteAccount(id: string): Promise<boolean> {
  const [deleted] = await db
    .delete(mailAccounts)
    .where(eq(mailAccounts.id, id))
    .returning({ id: mailAccounts.id });

  return Boolean(deleted);
}

/** Called by the sync engine after every run, successful or not. */
export async function saveProgress(
  accountId: string,
  progress: AccountProgress,
): Promise<void> {
  await db
    .update(mailAccounts)
    .set({
      uidValidity: progress.uidValidity,
      lastSeenUid: progress.lastSeenUid,
      lastError: progress.lastError,
      lastCheckedAt: progress.checkedAt,
      updatedAt: new Date(),
    })
    .where(eq(mailAccounts.id, accountId));
}

/**
 * Forgets where a mailbox got to, so the next run reads the folder from the
 * beginning. For when a parser is fixed and the emails it failed on need to
 * be read again; safe because saving a booking is keyed on the channel's own
 * reservation number.
 */
export async function rewind(id: string): Promise<boolean> {
  const [updated] = await db
    .update(mailAccounts)
    .set({ lastSeenUid: 0, uidValidity: null, lastError: null, updatedAt: new Date() })
    .where(eq(mailAccounts.id, id))
    .returning({ id: mailAccounts.id });

  return Boolean(updated);
}
