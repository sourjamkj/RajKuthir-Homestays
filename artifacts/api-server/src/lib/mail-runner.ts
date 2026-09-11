import { logger } from "./logger";
import { upsertImportedBooking } from "./ledger-repo";
import { readMailbox } from "./mail-imap";
import { listForSync, saveProgress } from "./mail-repo";
import { encryptionAvailable } from "./secret-box";
import { syncAccounts, type MailSyncResult } from "./mail-sync";
import type { ParsedVoucher } from "./mail-parsers/index";

/**
 * The live wiring: real mailboxes, the real database, the real clock.
 *
 * Everything here is a one-line adapter on purpose. The decisions live in
 * mail-sync.ts where they can be tested; if this file grows logic of its own,
 * that logic is untested and it belongs next door.
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
    if (!encryptionAvailable()) {
      // Without the key the stored passwords cannot be opened, so there is
      // nothing to try. Say so once rather than failing per account.
      logger.warn(
        "MAIL_ENCRYPTION_KEY is not set; skipping mailbox sync entirely.",
      );
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
