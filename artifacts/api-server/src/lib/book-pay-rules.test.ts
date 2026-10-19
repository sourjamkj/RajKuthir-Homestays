import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { DateRange } from "./availability.ts";
import {
  checkScreenshot,
  dueForExpiry,
  extendedHold,
  guestStatusText,
  hashPayToken,
  holdBlocks,
  holdsAsEvents,
  isNotMigrated,
  isUniqueViolation,
  liveHoldRanges,
  looksLikePayToken,
  newPayToken,
  nextFreeWindows,
  normaliseUtr,
  parseSettings,
  settingsProblem,
  upiIntentUrl,
  DEFAULT_BOOK_PAY_SETTINGS,
  type HoldRow,
} from "./book-pay-rules.ts";
import { startHold, type HoldRecord, type StartInput, type StartStore } from "./book-pay-start.ts";
import { advanceOf, quoteForEnquiry } from "./enquiry-quote.ts";
import { holdStateOf } from "./enquiry-hold.ts";
import { renderIcsFeed } from "./ics-export.ts";
import { DEFAULT_LADDER, applyWeeklyDiscount, minimumStayFor, nightPrice, DEFAULT_PEAKS } from "./pricing.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const NOW = new Date("2026-10-18T06:00:00Z");
const MIN = 60_000;

/* ------------------------------------------------------------------ */
/* An in-memory store with a real mutex, standing in for Postgres.    */
/* ------------------------------------------------------------------ */

function memoryStore(initiallyTaken: DateRange[] = []) {
  const holds: HoldRecord[] = [];
  let chain: Promise<unknown> = Promise.resolve();

  const store: StartStore<null> = {
    // Same guarantee as pg_advisory_xact_lock: one critical section at a time.
    withLock(work) {
      const run = chain.then(() => work(null));
      chain = run.catch(() => undefined);
      return run;
    },
    async takenRanges(_tx, now) {
      // Yield, so a broken lock would let both callers read before either writes.
      await new Promise((resolve) => setTimeout(resolve, 5));
      return [
        ...initiallyTaken,
        ...holds
          .filter((hold) => now < hold.holdExpiresAt)
          .map((hold) => ({ startDate: hold.input.checkIn, endDate: hold.input.checkOut })),
      ];
    },
    async createHold(_tx, record) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      holds.push(record);
      return { enquiryId: `enq-${holds.length}`, paymentRequestId: `pay-${holds.length}` };
    },
  };

  return { store, holds };
}

const party = (checkIn: string, checkOut: string, extra: Partial<StartInput> = {}): StartInput => ({
  name: "Test Guest",
  phone: "9876543210",
  email: null,
  requests: null,
  checkIn,
  checkOut,
  adults: 2,
  children: 0,
  pets: 0,
  ...extra,
});

const priceOf = (input: StartInput, advancePercent = 50) =>
  quoteForEnquiry(
    input,
    (iso, guests) => nightPrice(DEFAULT_LADDER, [], iso, guests),
    {
      nightPrices: (nights, guests) =>
        applyWeeklyDiscount(DEFAULT_LADDER, nights.map((iso) => nightPrice(DEFAULT_LADDER, [], iso, guests))),
      minimumStay: (nights) => minimumStayFor(DEFAULT_PEAKS, nights),
      advancePercent,
    },
  );

/* ------------------------------ required ------------------------------ */

test("overlapping holds can't both succeed — the second is refused inside the lock", async () => {
  const { store, holds } = memoryStore();
  const a = party("2026-11-05", "2026-11-07");
  const b = party("2026-11-06", "2026-11-08", { name: "Other Guest" });

  const [first, second] = await Promise.all([
    startHold(store, a, priceOf(a), DEFAULT_BOOK_PAY_SETTINGS, NOW, "2026-10-18"),
    startHold(store, b, priceOf(b), DEFAULT_BOOK_PAY_SETTINGS, NOW, "2026-10-18"),
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(holds.length, 1);
  if (!second.ok && second.status === 409) {
    // The refused guest is offered real alternatives that avoid the hold.
    assert.ok(second.nextFree.length > 0);
    for (const window of second.nextFree) {
      assert.ok(window.startDate >= "2026-11-07" || window.endDate <= "2026-11-05");
    }
  }
});

test("back-to-back holds both succeed (check-out day is free)", async () => {
  const { store } = memoryStore();
  const a = party("2026-11-05", "2026-11-07");
  const b = party("2026-11-07", "2026-11-09");
  const results = await Promise.all([
    startHold(store, a, priceOf(a), DEFAULT_BOOK_PAY_SETTINGS, NOW, "2026-10-18"),
    startHold(store, b, priceOf(b), DEFAULT_BOOK_PAY_SETTINGS, NOW, "2026-10-18"),
  ]);
  assert.deepEqual(results.map((r) => r.ok), [true, true]);
});

test("an expired hold frees its dates; a submitted one waits for the owner", async () => {
  const row = (status: HoldRow["status"], minutesLeft: number): HoldRow => ({
    id: status,
    status,
    holdExpiresAt: new Date(NOW.getTime() + minutesLeft * MIN),
    checkIn: "2026-11-05",
    checkOut: "2026-11-07",
  });

  assert.equal(holdBlocks(row("awaiting_payment", 10), NOW), true);
  assert.equal(holdBlocks(row("awaiting_payment", 0), NOW), false);
  assert.equal(holdBlocks(row("awaiting_payment", -5), NOW), false);
  // Guest says the money left their account: never released under them.
  assert.equal(holdBlocks(row("submitted", -600), NOW), true);
  for (const done of ["confirmed", "rejected", "expired"] as const) {
    assert.equal(holdBlocks(row(done, 60), NOW), false);
  }

  const rows = [row("awaiting_payment", -1), row("submitted", -1), row("awaiting_payment", 5)];
  assert.deepEqual(dueForExpiry(rows, NOW).map((r) => r.id), ["awaiting_payment"]);
  assert.equal(liveHoldRanges(rows, NOW).length, 2);

  // And the store-level consequence: a second guest can take the dates
  // once the first hold has run out, with no job having run.
  const { store } = memoryStore();
  const a = party("2026-12-01", "2026-12-03");
  await startHold(store, a, priceOf(a), { advancePercent: 50, holdMinutes: 30 }, NOW, "2026-10-18");
  const later = new Date(NOW.getTime() + 31 * MIN);
  const again = await startHold(store, a, priceOf(a), DEFAULT_BOOK_PAY_SETTINGS, later, "2026-10-18");
  assert.equal(again.ok, true);
});

test("duplicate UTR is rejected: unique index in schema and migration, mapped to 'already used'", () => {
  const sql = readFileSync(path.join(here, "../db/book-and-pay.sql"), "utf8");
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS payment_request_utr_uniq\s+ON payment_requests \(utr\)/);

  const schema = readFileSync(path.join(here, "../../../../lib/db/src/schema/payments.ts"), "utf8");
  assert.match(schema, /uniqueIndex\("payment_request_utr_uniq"\)\.on\(table\.utr\)/);

  // Raw and driver-wrapped Postgres errors both read as a duplicate.
  assert.equal(isUniqueViolation({ code: "23505" }), true);
  assert.equal(isUniqueViolation({ cause: { code: "23505" } }), true);
  assert.equal(isUniqueViolation({ code: "23503" }), false);

  // Formatting cannot sneak the same UTR past the index.
  assert.equal(normaliseUtr("4123 5678 9012"), "412356789012");
  assert.equal(normaliseUtr("4123-5678-9012"), "412356789012");
  assert.equal(normaliseUtr("412356789012"), "412356789012");
});

test("the amount on /pay is the quote's advance, to the paisa, in the UPI link too", async () => {
  const { store, holds } = memoryStore();
  const input = party("2026-11-06", "2026-11-09", { adults: 3, pets: 1 }); // Fri, Sat, Sun
  const quote = priceOf(input);
  assert.equal(quote.ok, true);
  if (!quote.ok) return;

  const started = await startHold(store, input, quote, DEFAULT_BOOK_PAY_SETTINGS, NOW, "2026-10-18");
  assert.equal(started.ok, true);
  if (!started.ok) return;

  // What /pay reads is what was stored, and what was stored is the quote.
  assert.equal(holds[0]!.totalPaise, quote.totalPaise);
  assert.equal(holds[0]!.advancePaise, quote.advancePaise);
  assert.equal(started.advancePaise, quote.advancePaise);
  assert.equal(quote.advancePaise, advanceOf(quote.totalPaise, 50));

  const url = upiIntentUrl({
    upiId: "rajkuthir@okaxis",
    payeeName: "Raj Kuthir Homestays",
    amountPaise: holds[0]!.advancePaise,
    note: started.reference,
  });
  assert.ok(url.includes(`am=${(quote.advancePaise / 100).toFixed(2)}&`));
  assert.ok(url.startsWith("upi://pay?pa=rajkuthir@okaxis&pn=Raj%20Kuthir%20Homestays&am="));
  assert.ok(url.includes("&cu=INR&tn=RK-06NOV-"));
});

test("iCal export includes live holds and drops expired ones", () => {
  const rows: HoldRow[] = [
    { id: "live", status: "awaiting_payment", holdExpiresAt: new Date(NOW.getTime() + 20 * MIN), checkIn: "2026-11-20", checkOut: "2026-11-22" },
    { id: "paid", status: "submitted", holdExpiresAt: new Date(NOW.getTime() - 20 * MIN), checkIn: "2026-11-25", checkOut: "2026-11-26" },
    { id: "gone", status: "awaiting_payment", holdExpiresAt: new Date(NOW.getTime() - 1 * MIN), checkIn: "2026-12-01", checkOut: "2026-12-03" },
  ];

  const ics = renderIcsFeed(holdsAsEvents(liveHoldRanges(rows, NOW), NOW));

  assert.ok(ics.includes("DTSTART;VALUE=DATE:20261120"));
  assert.ok(ics.includes("DTEND;VALUE=DATE:20261122"));
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20261125"));
  assert.ok(!ics.includes("20261201"));
  assert.ok(ics.includes("UID:live-hold@rajkuthirhomestays"));
  // Feed shows no guest detail for a hold, same as for a booking.
  assert.ok(!/Test Guest|payment/i.test(ics.split("BEGIN:VEVENT")[1]!.replace("Reserved - Raj Kuthir", "")));
});

/* ----------------------------- supporting ----------------------------- */

test("server prices it: a short peak stay is refused before any hold", async () => {
  const { store, holds } = memoryStore();
  const input = party("2026-12-31", "2027-01-01");
  const result = await startHold(store, input, priceOf(input), DEFAULT_BOOK_PAY_SETTINGS, NOW, "2026-10-18");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /2-night minimum/);
  assert.equal(holds.length, 0);
});

test("advance percentage is a setting, default 50, never above the total", () => {
  assert.equal(advanceOf(640_000), 320_000);
  assert.equal(advanceOf(640_000, 30), 192_000);
  assert.equal(advanceOf(640_100, 50), 320_100); // rounded up to a whole rupee
  assert.equal(advanceOf(640_000, 100), 640_000);

  assert.equal(settingsProblem({ advancePercent: 50, holdMinutes: 30 }), null);
  assert.match(settingsProblem({ advancePercent: 5, holdMinutes: 30 }) ?? "", /advance/);
  assert.match(settingsProblem({ advancePercent: 50, holdMinutes: 2 }) ?? "", /hold/);
  assert.deepEqual(parseSettings('{"advancePercent":40}'), { advancePercent: 40, holdMinutes: 30 });
  assert.deepEqual(parseSettings("garbage"), DEFAULT_BOOK_PAY_SETTINGS);
  assert.deepEqual(parseSettings('{"advancePercent":3}'), DEFAULT_BOOK_PAY_SETTINGS);
});

test("UTR must be exactly 12 digits", () => {
  for (const bad of ["", "12345678901", "1234567890123", "ABCDEF123456", null, 123456789012]) {
    assert.equal(normaliseUtr(bad), null, String(bad));
  }
});

test("a UTR stretches the hold to 12 hours and never shortens it", () => {
  const soon = new Date(NOW.getTime() + 10 * MIN);
  assert.equal(extendedHold(soon, NOW).getTime(), NOW.getTime() + 12 * 60 * MIN);
  const far = new Date(NOW.getTime() + 20 * 60 * MIN);
  assert.equal(extendedHold(far, NOW).getTime(), far.getTime());
});

test("the owner's enquiry list shows the Book & Pay deadline, not the 24h default", () => {
  const holdExpiresAt = new Date(NOW.getTime() + 25 * MIN);
  const state = holdStateOf({ quoteSentAt: new Date(NOW.getTime() - 5 * MIN), advancePaidAt: null, holdExpiresAt }, NOW);
  assert.equal(state.state, "held");
  if (state.state === "held") assert.equal(state.expiresAt.getTime(), holdExpiresAt.getTime());
  // Without an override, unchanged behaviour: 24 hours from the quote.
  const legacy = holdStateOf({ quoteSentAt: NOW, advancePaidAt: null }, NOW);
  assert.equal(legacy.state === "held" && legacy.expiresAt.getTime(), NOW.getTime() + 24 * 60 * MIN);
});

test("next free dates skip taken nights and keep the stay length", () => {
  const taken = [
    { startDate: "2026-11-05", endDate: "2026-11-08" },
    { startDate: "2026-11-09", endDate: "2026-11-10" },
  ];
  const windows = nextFreeWindows({ startDate: "2026-11-05", endDate: "2026-11-07" }, taken, { today: "2026-10-18" });
  assert.deepEqual(windows[0], { startDate: "2026-11-10", endDate: "2026-11-12" });
  assert.equal(windows.length, 3);
});

test("pay tokens are random, URL-safe and stored only as a hash", () => {
  const a = newPayToken();
  const b = newPayToken();
  assert.notEqual(a, b);
  assert.ok(looksLikePayToken(a));
  assert.equal(hashPayToken(a).length, 64);
  assert.notEqual(hashPayToken(a), a);
  assert.equal(looksLikePayToken("../../etc/passwd"), false);
});

test("screenshot: images only, 5 MB, bytes must match the type", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal(checkScreenshot({ mimeType: "image/png", dataBase64: png.toString("base64") }).ok, true);
  assert.equal(checkScreenshot({ mimeType: "application/pdf", dataBase64: png.toString("base64") }).ok, false);
  assert.equal(checkScreenshot({ mimeType: "image/jpeg", dataBase64: png.toString("base64") }).ok, false);
  const big = Buffer.alloc(5 * 1024 * 1024 + 10, 0);
  png.copy(big);
  assert.equal(checkScreenshot({ mimeType: "image/png", dataBase64: big.toString("base64") }).ok, false);
});

test("the guest is never told 'confirmed' before the owner confirms", () => {
  for (const status of ["awaiting_payment", "submitted", "rejected", "expired"] as const) {
    assert.doesNotMatch(guestStatusText(status, false), /confirmed/i, status);
  }
  assert.equal(guestStatusText("submitted", false), "Payment submitted — we'll confirm within a few hours.");
  assert.match(guestStatusText("confirmed", false), /confirmed/i);
});

test("missing tables read as 'not set up yet', not as a crash", () => {
  assert.equal(isNotMigrated({ code: "42P01" }), true);
  assert.equal(isNotMigrated({ cause: { code: "42704" } }), true);
  assert.equal(isNotMigrated(new Error("boom")), false);
});

test("the boot-time migration is exactly src/db/book-and-pay.sql", () => {
  const sql = readFileSync(path.join(here, "../db/book-and-pay.sql"), "utf8");
  const ts = readFileSync(path.join(here, "book-pay-migrate.ts"), "utf8");
  const start = ts.indexOf("BOOK_PAY_MIGRATION_SQL = `") + "BOOK_PAY_MIGRATION_SQL = `".length;
  const embedded = ts.slice(start, ts.indexOf("`;", start));
  assert.equal(embedded, sql);
  // Additive only: nothing that could touch existing data.
  assert.doesNotMatch(sql, /^\s*(DROP|ALTER|DELETE|TRUNCATE|UPDATE)\b/im);
});
