import { parseMessage, type ParsedVoucher } from "./mail-parsers/index.ts";

/**
 * The mailbox-reading engine, with every side effect injected.
 *
 * Nothing in this file opens a socket or touches the database. That is not
 * architectural decoration: it means the awkward parts — a folder that resets
 * its UIDs, a message that parses but fails to save, a mailbox that refuses
 * the password — can be tested here in milliseconds, with no mailbox and no
 * Postgres. The live wiring lives in mail-runner.ts and is deliberately dull.
 */

export type MailMessage = {
  /** IMAP UID. Monotonic within a folder, for a given UIDVALIDITY. */
  uid: number;
  from: string;
  subject: string;
  body: string;
};

export type MailboxRead = {
  /**
   * The folder's UIDVALIDITY as the server reports it. A change means every
   * UID we remember is meaningless and the folder must be read again.
   */
  uidValidity: string;
  messages: MailMessage[];
};

/** What the engine needs to know about a mailbox — not the database row. */
export type SyncableAccount = {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  /** Already opened by secret-box. Never logged, never returned by a route. */
  password: string;
  folder: string;
  lastSeenUid: number;
  uidValidity: string | null;
};

export type AccountProgress = {
  uidValidity: string | null;
  lastSeenUid: number;
  lastError: string | null;
  checkedAt: Date;
};

export type SyncDeps = {
  /** Opens the mailbox and returns messages with a UID above `sinceUid`. */
  read: (account: SyncableAccount, sinceUid: number) => Promise<MailboxRead>;
  /** Writes one parsed booking. Must be idempotent — it will see repeats. */
  saveBooking: (voucher: ParsedVoucher) => Promise<void>;
  saveProgress: (accountId: string, progress: AccountProgress) => Promise<void>;
  now?: () => Date;
};

export type AccountSyncResult = {
  accountId: string;
  label: string;
  status: "ok" | "error";
  /** Messages the reader handed us, above the high-water mark. */
  scanned: number;
  /** Messages a parser recognised as a booking or a cancellation. */
  matched: number;
  /** Bookings written. */
  imported: number;
  /** True when the folder's UIDs were renumbered and we started again. */
  uidValidityReset: boolean;
  highestUid: number;
  message: string;
};

export type MailSyncResult = {
  syncedAt: string;
  accounts: AccountSyncResult[];
  imported: number;
};

/**
 * Anything thrown out of a read or a save, reduced to one line a person can
 * act on. Takes the message rather than the error object because this string
 * is stored and shown, and an error object can carry the connection details
 * — including the password — in its properties.
 */
function reason(error: unknown, secret?: string): string {
  const raw =
    error instanceof Error && error.message ? error.message : "Unknown error";

  // IMAP libraries have been known to echo the credentials they were handed
  // back in an error string. This message gets stored in the database and
  // shown on an admin screen, so scrub the one secret we know we passed in.
  const scrubbed =
    secret && secret.length > 3 ? raw.split(secret).join("***") : raw;

  return scrubbed.slice(0, 300);
}

export async function syncAccount(
  account: SyncableAccount,
  deps: SyncDeps,
): Promise<AccountSyncResult> {
  const checkedAt = (deps.now ?? (() => new Date()))();

  const base: Omit<AccountSyncResult, "status" | "message"> = {
    accountId: account.id,
    label: account.label,
    scanned: 0,
    matched: 0,
    imported: 0,
    uidValidityReset: false,
    highestUid: account.lastSeenUid,
  };

  let read: MailboxRead;
  try {
    read = await deps.read(account, account.lastSeenUid);
  } catch (error) {
    // Connection refused, password rejected, folder gone. Leave lastSeenUid
    // alone: a failed run must never skip mail it has not seen.
    await deps.saveProgress(account.id, {
      uidValidity: account.uidValidity,
      lastSeenUid: account.lastSeenUid,
      lastError: reason(error, account.password),
      checkedAt,
    });
    return {
      ...base,
      status: "error",
      message: reason(error, account.password),
    };
  }

  // A renumbered folder: every UID we stored refers to nothing. Read it from
  // the beginning rather than trust the old high-water mark. Re-reading is
  // harmless because saving a booking is keyed on the channel's own
  // reservation number, so a second sighting updates rather than duplicates.
  const uidValidityReset =
    account.uidValidity !== null && account.uidValidity !== read.uidValidity;
  const floor = uidValidityReset ? 0 : account.lastSeenUid;

  const fresh = read.messages
    .filter((message) => message.uid > floor)
    .sort((a, b) => a.uid - b.uid);

  let highestUid = floor;
  let matched = 0;
  let imported = 0;

  for (const message of fresh) {
    const hit = parseMessage({
      from: message.from,
      subject: message.subject,
      body: message.body,
    });

    // Not a booking email — the overwhelming majority of any mailbox. Move
    // past it and say nothing; treating this as a failure would bury the
    // real ones in noise.
    if (!hit) {
      highestUid = message.uid;
      continue;
    }

    matched += 1;

    try {
      await deps.saveBooking(hit.voucher);
    } catch (error) {
      // Stop rather than skip. The high-water mark stays below this message
      // so the next run tries it again; sailing past a booking we failed to
      // save is how a stay silently never reaches the calendar.
      await deps.saveProgress(account.id, {
        uidValidity: read.uidValidity,
        lastSeenUid: highestUid,
        lastError: `Could not save ${hit.voucher.externalRef}: ${reason(error, account.password)}`,
        checkedAt,
      });
      return {
        ...base,
        status: "error",
        scanned: fresh.length,
        matched,
        imported,
        uidValidityReset,
        highestUid,
        message: `Stopped at ${hit.voucher.externalRef}: ${reason(error, account.password)}`,
      };
    }

    imported += 1;
    highestUid = message.uid;
  }

  await deps.saveProgress(account.id, {
    uidValidity: read.uidValidity,
    lastSeenUid: highestUid,
    lastError: null,
    checkedAt,
  });

  return {
    ...base,
    status: "ok",
    scanned: fresh.length,
    matched,
    imported,
    uidValidityReset,
    highestUid,
    message: uidValidityReset
      ? `Mailbox was renumbered; read again from the start. ${imported} imported.`
      : `${fresh.length} new message${fresh.length === 1 ? "" : "s"}, ${imported} imported.`,
  };
}

export async function syncAccounts(
  accounts: SyncableAccount[],
  deps: SyncDeps,
): Promise<MailSyncResult> {
  const results: AccountSyncResult[] = [];

  // Sequential on purpose. Two mailboxes are not worth the concurrency, and
  // several IMAP connections opening at once is exactly what makes a provider
  // start refusing them.
  for (const account of accounts) {
    results.push(await syncAccount(account, deps));
  }

  return {
    syncedAt: (deps.now ?? (() => new Date()))().toISOString(),
    accounts: results,
    imported: results.reduce((total, result) => total + result.imported, 0),
  };
}
