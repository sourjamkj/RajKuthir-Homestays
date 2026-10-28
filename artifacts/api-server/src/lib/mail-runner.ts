import { logger } from "./logger";
import {
  applyChannelDetails,
  applyChannelNotice,
  upsertImportedBooking,
} from "./ledger-repo";
import { listForSync, saveProgress } from "./mail-repo";
import { encryptionProblem } from "./secret-box";
import {
  syncAccounts,
  type MailboxRead,
  type MailSyncResult,
  type SyncableAccount,
} from "./mail-sync";
import { parseMessage, type ParsedVoucher } from "./mail-parsers/index";
import { backfillOtaDocuments, saveOtaDocuments } from "./ota-documents";
import { appSettings, db } from "@workspace/db";
import { eq } from "drizzle-orm";

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
  const read = await open(account, sinceUid);
  // OTA PDFs (vouchers, statements) are filed as the mail is read. Never
  // throws, so a storage problem cannot hold up the booking import.
  await saveOtaDocuments(read.messages);
  return read;
}

/**
 * A parsed voucher becomes a booking row.
 *
 * `upsertImportedBooking` is keyed on (source, externalRef), so reading the
 * same email twice updates one row rather than creating a second — which is
 * what makes re-reading a mailbox safe after a parser fix.
 */
async function saveBooking(voucher: ParsedVoucher): Promise<void> {
  // Booking.com sends the stay in pieces; each piece updates only what it knows.
  if (voucher.kind === "notice") {
    await applyChannelNotice({
      source: voucher.source,
      externalRef: voucher.externalRef,
      status: voucher.status,
      checkIn: voucher.checkIn,
      importedFromEmail: voucher.sourceSubject,
    });
    return;
  }
  if (voucher.kind === "details") {
    await applyChannelDetails({
      source: voucher.source,
      externalRef: voucher.externalRef,
      guestName: voucher.guestName,
      checkIn: voucher.checkIn,
      checkOut: voucher.checkOut,
      guests: voucher.guests,
      importedFromEmail: voucher.sourceSubject,
    });
    return;
  }

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


/* ------------------------------------------------------------------ *
 * One-off backfill: every Booking.com email already in the mailbox.
 *
 * The normal sync only reads mail above its high-water mark, so emails that
 * arrived before the Booking.com parser existed were passed over. This reads
 * just the Booking.com messages (IMAP SEARCH, not the whole folder), oldest
 * first, and saves them through the same saveBooking. Idempotent: bookings
 * are keyed on the reservation number, so a second run changes nothing. The
 * high-water mark is not touched, and Go-MMT mail is not re-read.
 * ------------------------------------------------------------------ */

const BACKFILL_KEY = "mail.backfill.bookingCom";

export type BackfillResult = {
  ranAt: string;
  mailboxes: number;
  scanned: number;
  saved: number;
  failed: number;
  errors: string[];
};

export async function getBookingComBackfill(): Promise<BackfillResult | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, BACKFILL_KEY));
  try {
    return row?.value ? (JSON.parse(row.value) as BackfillResult) : null;
  } catch {
    return null;
  }
}

export async function backfillBookingCom(): Promise<BackfillResult> {
  const result: BackfillResult = {
    ranAt: new Date().toISOString(),
    mailboxes: 0,
    scanned: 0,
    saved: 0,
    failed: 0,
    errors: [],
  };

  if (encryptionProblem()) {
    result.errors.push("Mailbox passwords cannot be opened (MAIL_ENCRYPTION_KEY).");
    return result;
  }

  const { readBySender } = await import("./mail-imap");

  for (const account of await listForSync()) {
    result.mailboxes += 1;
    let messages;
    try {
      messages = await readBySender(account, "booking.com");
    } catch (error) {
      result.errors.push(`${account.label}: ${error instanceof Error ? error.message.slice(0, 200) : "could not read"}`);
      continue;
    }

    for (const message of messages) {
      result.scanned += 1;
      const hit = parseMessage(message);
      if (!hit || hit.parser.name !== "Booking.com") continue;
      try {
        await saveBooking(hit.voucher);
        result.saved += 1;
      } catch (error) {
        result.failed += 1;
        if (result.errors.length < 10) {
          result.errors.push(`${hit.voucher.externalRef}: ${error instanceof Error ? error.message.slice(0, 160) : "save failed"}`);
        }
      }
    }
  }

  // Remembered only when every mailbox was read, so a failed attempt retries
  // on the next boot instead of being marked done.
  if (result.mailboxes > 0 && result.errors.length === 0) {
    const value = JSON.stringify(result);
    await db
      .insert(appSettings)
      .values({ key: BACKFILL_KEY, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  }

  logger.info(
    { mailboxes: result.mailboxes, scanned: result.scanned, saved: result.saved, failed: result.failed },
    "Booking.com email backfill finished",
  );
  return result;
}

/** Runs the backfill once, a minute after boot, if it has never completed. */
export function scheduleBookingComBackfill(): void {
  setTimeout(() => {
    void (async () => {
      try {
        if (await getBookingComBackfill()) return;
        await backfillBookingCom();
      } catch (error) {
        logger.error({ err: error }, "Booking.com email backfill failed");
      }
    })();
  }, 60_000).unref?.();
}

/**
 * Files the PDFs from OTA emails already in the mailbox, once, two minutes
 * after boot. New ones are filed by the normal sync as they arrive.
 */
export function scheduleOtaDocumentBackfill(): void {
  setTimeout(() => {
    void (async () => {
      try {
        if (encryptionProblem()) return;
        const { readBySender } = await import("./mail-imap");
        await backfillOtaDocuments(await listForSync(), readBySender);
      } catch (error) {
        logger.error({ err: error }, "OTA document backfill failed");
      }
    })();
  }, 120_000).unref?.();
}
