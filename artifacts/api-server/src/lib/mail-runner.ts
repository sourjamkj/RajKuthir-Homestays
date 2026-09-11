import { logger } from "./logger";
import { upsertImportedBooking } from "./ledger-repo";
import { listForSync, saveProgress } from "./mail-repo";
import { encryptionProblem } from "./secret-box";
import {
  syncAccounts,
  type MailboxRead,
  type MailSyncResult,
  type SyncableAccount,
} from "./mail-sync";
import type { ParsedVoucher } from "./mail-parsers/index";

/**
 * The live wiring: real mailboxes, the real database, the real clock.
 *
 * Everything here is a one-line adapter on purpose. The decisions live in
 * mail-sync.ts where they can be tested; if this file grows logic of its own,
 * that logic is untested and it belongs next door.
 *
 * NOTE THE MISSING IMPORT. ./mail-imap is loaded on demand inside readMailbox,
 * never at the top of this file, and that is deliberate.
 *
 * mail-imap pulls in imapflow and mailparser. A static import chains them into
 * the server's startup path — index.ts -> mail-cron -> here -> mail-imap —
 * so anything wrong with those packages stops the server booting rather than
 * stopping the mail feature. That is not a hypothetical: on 11 September a
 * bundler setting left mailparser's copy of nodemailer out of the image and
 * the whole site went down for half an hour, because a homestay website could
 * not read its email.
 *
 * Loaded here instead, a broken or missing mail dependency surfaces as a
 * rejected promise inside syncAccount, which already knows what to do with
 * one: record it against the mailbox, leave the high-water mark alone, carry
 * on with the others. The website stays up. A test asserts this file has no
 * static import of the adapter.
 */

let inFlight: Promise<MailSyncResult> | null = null;
let lastResult: MailSyncResult | null = null;

export function getLastMailSync(): MailSyncResult | null {
  return lastResult;
}

export function isMailSyncInFlight(): boolean {
  return inFlight !== null;
}

/**
 * Opens a mailbox, loading the IMAP adapter the first time it is needed.
 *
 * `import()` caches, so this costs one resolution per process, not one per
 * run. If the adapter cannot be loaded at all the rejection lands in
 * syncAccount's read error path and is recorded against the mailbox.
 */
async function readMailbox(
  account: SyncableAccount,
  sinceUid: number,
): Promise<MailboxRead> {
  const { readMailbox: open } = await import("./mail-imap");
  return open(account, sinceUid);
}

/**
 * A parsed voucher becomes a booking row.
 *
 * `upsertImportedBooking` is keyed on (source, externalRef), so reading the
 * same email twice updates one row rather than creating a second — which is
 * what makes re-reading a mailbox safe after a parser fix.
 */
async function saveBooking(voucher: ParsedVoucher): Promise<void> {
  await upsertImportedBooking({
    source: voucher.source,
    externalRef: voucher.externalRef,
    status: voucher.status === "cancelled" ? "cancelled" : "confirmed",
    guestName: voucher.guestName,
    checkIn: voucher.checkIn,
    checkOut: voucher.checkOut,
    guests: voucher.guests,
    grossPaise: voucher.grossPaise,
    commissionPaise: voucher.commissionPaise,
    taxPaise: voucher.taxPaise,
    receivedPaise: voucher.receivedPaise,
    // The subject line is the audit trail: which email produced this row.
    importedFromEmail: voucher.sourceSubject,
  });
}

export async function runMailSync(): Promise<MailSyncResult> {
  // One run at a time. The cron and an impatient admin clicking "Check now"
  // must not open two sets of IMAP connections to the same mailbox.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const problem = encryptionProblem();
    if (problem) {
      // Without a usable key the stored passwords cannot be opened, so there
      // is nothing to try. Say so once rather than failing per account — and
      // say *why*, because "not set" and "set to the wrong thing" send you
      // looking in completely different places.
      logger.warn({ problem }, "Skipping mailbox sync entirely.");
      return { syncedAt: new Date().toISOString(), accounts: [], imported: 0 };
    }

    const accounts = await listForSync();

    if (accounts.length === 0) {
      return { syncedAt: new Date().toISOString(), accounts: [], imported: 0 };
    }

    const result = await syncAccounts(accounts, {
      read: readMailbox,
      saveBooking,
      saveProgress,
    });

    logger.info(
      {
        mailboxes: result.accounts.length,
        imported: result.imported,
        failed: result.accounts.filter((a) => a.status === "error").length,
      },
      "Mailbox sync finished",
    );

    return result;
  })();

  try {
    lastResult = await inFlight;
    return lastResult;
  } finally {
    inFlight = null;
  }
}
