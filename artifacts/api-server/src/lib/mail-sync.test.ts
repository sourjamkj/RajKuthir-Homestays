import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  syncAccount,
  syncAccounts,
  type AccountProgress,
  type MailMessage,
  type MailboxRead,
  type SyncableAccount,
} from "./mail-sync.ts";
import type { ParsedVoucher } from "./mail-parsers/index.ts";

/**
 * The mailbox reader, tested against the awkward cases rather than the happy
 * one. No IMAP server, no database: the engine takes its side effects as
 * arguments precisely so these can run in a few milliseconds on every commit.
 *
 * The booking emails are the real Go-MMT fixtures already used by gomt.test.ts.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(path.join(here, "mail-parsers/__fixtures__", name), "utf8");

const BOOKING_OCT = fixture("booking-oct.txt");
const BOOKING_AUG = fixture("booking-aug.txt");

const GOMMT = "noreply@go-mmt.com";

function account(overrides: Partial<SyncableAccount> = {}): SyncableAccount {
  return {
    id: "acct-1",
    label: "Gmail — bookings",
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    username: "owner@example.com",
    password: "app-password-not-a-real-one",
    folder: "INBOX",
    lastSeenUid: 0,
    uidValidity: null,
    ...overrides,
  };
}

function message(uid: number, overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    uid,
    from: GOMMT,
    subject: "Booking Voucher",
    body: BOOKING_OCT,
    ...overrides,
  };
}

/** A recording stand-in for the mailbox, the database and the clock. */
function harness(read: MailboxRead | (() => Promise<MailboxRead>)) {
  const saved: ParsedVoucher[] = [];
  const progress: AccountProgress[] = [];
  let failSave: ((voucher: ParsedVoucher) => void) | null = null;

  return {
    saved,
    progress,
    failSaveOn(ref: string) {
      failSave = (voucher) => {
        if (voucher.externalRef === ref) throw new Error("database is down");
      };
    },
    deps: {
      read: typeof read === "function" ? () => read() : async () => read,
      saveBooking: async (voucher: ParsedVoucher) => {
        failSave?.(voucher);
        saved.push(voucher);
      },
      saveProgress: async (_id: string, entry: AccountProgress) => {
        progress.push(entry);
      },
      now: () => new Date("2026-09-11T18:00:00Z"),
    },
  };
}

// ===================================================== THE ORDINARY CASE

test("mail · imports a booking email and remembers where it got to", async () => {
  const h = harness({ uidValidity: "42", messages: [message(7)] });
  const result = await syncAccount(account(), h.deps);

  assert.equal(result.status, "ok");
  assert.equal(result.matched, 1);
  assert.equal(result.imported, 1);
  assert.equal(result.highestUid, 7);
  assert.equal(h.saved[0]?.externalRef, "GH75081277131254");
  assert.equal(h.saved[0]?.source, "makeMyTrip");
  assert.deepEqual(h.progress.at(-1)?.lastSeenUid, 7);
  assert.equal(h.progress.at(-1)?.lastError, null);
  assert.equal(h.progress.at(-1)?.uidValidity, "42");
});

test("mail · mail that is not a booking is passed over silently", async () => {
  const h = harness({
    uidValidity: "42",
    messages: [
      message(1, { from: "aunt@example.com", subject: "Lunch?", body: "Sunday?" }),
      message(2, { from: "newsletter@example.com", body: "Unsubscribe" }),
    ],
  });

  const result = await syncAccount(account(), h.deps);

  assert.equal(result.status, "ok");
  assert.equal(result.scanned, 2);
  assert.equal(result.matched, 0, "a newsletter was treated as a booking");
  assert.equal(h.saved.length, 0);
  // Still advances: otherwise every run re-reads the same non-bookings forever.
  assert.equal(h.progress.at(-1)?.lastSeenUid, 2);
});

test("mail · a message at or below the high-water mark is not read twice", async () => {
  const h = harness({
    uidValidity: "42",
    messages: [message(5), message(9, { body: BOOKING_AUG })],
  });

  const result = await syncAccount(account({ lastSeenUid: 5, uidValidity: "42" }), h.deps);

  assert.equal(result.scanned, 1, "re-read a message it had already processed");
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0]?.checkIn, "2026-08-12", "read the wrong message");
});

// ===================================================== THE AWKWARD CASES

test("mail · a renumbered mailbox is read again from the beginning", async () => {
  // UIDVALIDITY changing is the one case where a stored UID is not just stale
  // but meaningless. Trusting it would skip every message in the folder.
  const h = harness({ uidValidity: "99", messages: [message(2), message(3)] });

  const result = await syncAccount(
    account({ lastSeenUid: 500, uidValidity: "42" }),
    h.deps,
  );

  assert.equal(result.uidValidityReset, true);
  assert.equal(result.scanned, 2, "skipped mail after the folder was renumbered");
  assert.equal(h.progress.at(-1)?.uidValidity, "99");
  assert.match(result.message, /renumbered/i);
});

test("mail · a mailbox that will not open leaves the high-water mark alone", async () => {
  const h = harness(async () => {
    throw new Error("Invalid credentials (Failure)");
  });

  const result = await syncAccount(
    account({ lastSeenUid: 120, uidValidity: "42" }),
    h.deps,
  );

  assert.equal(result.status, "error");
  assert.match(result.message, /Invalid credentials/);
  const last = h.progress.at(-1);
  assert.equal(last?.lastSeenUid, 120, "a failed run moved the high-water mark");
  assert.equal(last?.uidValidity, "42");
  assert.match(last?.lastError ?? "", /Invalid credentials/);
});

test("mail · a booking that fails to save is retried, not skipped", async () => {
  const h = harness({
    uidValidity: "42",
    messages: [
      message(1, { from: "aunt@example.com", body: "nothing here" }),
      message(2, { body: BOOKING_OCT }),
      message(3, { body: BOOKING_AUG }),
    ],
  });
  h.failSaveOn("GH75081277131254");

  const result = await syncAccount(account(), h.deps);

  assert.equal(result.status, "error");
  assert.equal(result.imported, 0);
  // Stopped below the message it could not save, so the next run sees it
  // again. The later booking is deliberately NOT imported out of order.
  assert.equal(h.progress.at(-1)?.lastSeenUid, 1);
  assert.equal(h.saved.length, 0);
  assert.match(result.message, /GH75081277131254/);
});

test("mail · the password never reaches a stored message", async () => {
  const secret = "swordfish-app-password";
  const h = harness(async () => {
    throw new Error(`LOGIN failed for ${secret}`);
  });

  const result = await syncAccount(account({ password: secret }), h.deps);

  // IMAP libraries have echoed credentials back in error strings before, and
  // this string is stored and displayed. It must come out scrubbed.
  const stored = `${h.progress.at(-1)?.lastError} ${result.message}`;
  assert.ok(!stored.includes(secret), "the mailbox password reached a stored error");
  assert.match(stored, /LOGIN failed for \*\*\*/);
});

// ===================================================== SEVERAL MAILBOXES

test("mail · one failing mailbox does not stop the others", async () => {
  const gmail = account({ id: "a", label: "Gmail" });
  const yahoo = account({ id: "b", label: "Yahoo" });

  const saved: ParsedVoucher[] = [];
  const progress: Array<{ id: string; entry: AccountProgress }> = [];

  const result = await syncAccounts([gmail, yahoo], {
    read: async (acct) => {
      if (acct.id === "a") throw new Error("connection reset");
      return { uidValidity: "1", messages: [message(4)] };
    },
    saveBooking: async (voucher) => {
      saved.push(voucher);
    },
    saveProgress: async (id, entry) => {
      progress.push({ id, entry });
    },
    now: () => new Date("2026-09-11T18:00:00Z"),
  });

  assert.equal(result.accounts.length, 2);
  assert.equal(result.accounts[0]?.status, "error");
  assert.equal(result.accounts[1]?.status, "ok");
  assert.equal(result.imported, 1, "a broken mailbox blocked a working one");
  assert.equal(saved.length, 1);
  assert.equal(progress.length, 2, "every mailbox should record an outcome");
});
