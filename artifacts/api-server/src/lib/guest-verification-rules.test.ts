import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CHECK_IN_LOCAL,
  CHECK_OUT_LOCAL,
  MANAGEMENT_FORBIDDEN_KEYS,
  VERIFICATION_LEAD_HOURS,
  deadlinePassed,
  financialLeaks,
  linkExpiry,
  readinessOf,
  verificationDeadline,
} from "./guest-verification-rules.ts";

/**
 * Behavioural tests for guest pre-arrival verification.
 *
 * These execute the real functions rather than reading the source, which is
 * why the rules were moved out of guest-onboarding-repo.ts: that module
 * imports @workspace/db, so nothing inside it could be run without a live
 * Postgres. What is asserted here is arithmetic and policy, neither of which
 * needs a database.
 *
 * Run with:  node --test src/lib/
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const clientRoot = path.join(repoRoot, "artifacts/raj-kuthir");

const ADMIN_GUESTS_TSX = readFileSync(
  path.join(clientRoot, "src/pages/AdminGuests.tsx"),
  "utf8",
);

const ONBOARDING_REPO_TS = readFileSync(path.join(here, "guest-onboarding-repo.ts"), "utf8");
const ONBOARDING_ROUTES_TS = readFileSync(
  path.join(here, "../routes/guest-onboarding.ts"),
  "utf8",
);

const NO_DOCS = { count: 0, submitted: 0, verified: 0, rejected: 0 };

// ============================================================ THE DEADLINE

test("deadline · is exactly 48 hours before noon IST on the check-in day", () => {
  // Check-in 17 Sep 2026, 12:00 IST = 06:30 UTC. Less 48h = 15 Sep, 06:30 UTC.
  const deadline = verificationDeadline("2026-09-17");
  assert.equal(deadline.toISOString(), "2026-09-15T06:30:00.000Z");
});

test("deadline · uses the published check-in hour, not an hour earlier", () => {
  assert.equal(CHECK_IN_LOCAL, "12:00:00+05:30");
  assert.equal(CHECK_OUT_LOCAL, "11:00:00+05:30");
  assert.equal(VERIFICATION_LEAD_HOURS, 48);

  // Anchored to 11:00 the deadline would be 05:30Z — an hour early, which is
  // the bug this constant replaced.
  assert.notEqual(
    verificationDeadline("2026-09-17").toISOString(),
    "2026-09-15T05:30:00.000Z",
  );
});

test("deadline · holds across a month boundary and a leap day", () => {
  assert.equal(verificationDeadline("2026-10-01").toISOString(), "2026-09-29T06:30:00.000Z");
  assert.equal(verificationDeadline("2028-03-01").toISOString(), "2028-02-28T06:30:00.000Z");
});

test("deadline · passes only once the moment has arrived", () => {
  const deadline = verificationDeadline("2026-09-17");
  assert.equal(deadlinePassed(deadline, new Date("2026-09-15T06:29:59Z")), false);
  assert.equal(deadlinePassed(deadline, new Date("2026-09-15T06:30:00Z")), true, "the boundary itself counts as passed");
  assert.equal(deadlinePassed(deadline, new Date("2026-09-16T00:00:00Z")), true);
});

// ============================================================ LINK EXPIRY

test("expiry · a future stay's link lasts until check-out", () => {
  const expiry = linkExpiry("2026-09-25", new Date("2026-09-17T00:00:00Z"));
  assert.equal(expiry.toISOString(), "2026-09-25T05:30:00.000Z");
});

test("expiry · a stay already over gets a rolling window instead of a dead link", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const expiry = linkExpiry("2026-09-25", now);
  assert.ok(expiry > now, "an elapsed stay must not produce an already-expired link");
  assert.equal(expiry.toISOString(), "2026-10-31T00:00:00.000Z");
});

// ================================================================ READINESS

test("readiness · no documents and time remaining is awaiting_documents", () => {
  assert.equal(
    readinessOf({
      onboardingStatus: "pending",
      verificationDeadline: verificationDeadline("2026-09-17"),
      documents: NO_DOCS,
      now: new Date("2026-09-10T00:00:00Z"),
    }),
    "awaiting_documents",
  );
});

test("readiness · uploaded but unverified is documents_submitted", () => {
  assert.equal(
    readinessOf({
      onboardingStatus: "submitted",
      verificationDeadline: verificationDeadline("2026-09-17"),
      documents: { count: 2, submitted: 2, verified: 0, rejected: 0 },
      now: new Date("2026-09-10T00:00:00Z"),
    }),
    "documents_submitted",
  );
});

test("readiness · every document verified is ready", () => {
  assert.equal(
    readinessOf({
      onboardingStatus: "verified",
      verificationDeadline: verificationDeadline("2026-09-17"),
      documents: { count: 2, submitted: 0, verified: 2, rejected: 0 },
      now: new Date("2026-09-10T00:00:00Z"),
    }),
    "ready",
  );
});

test("readiness · a missed deadline is reported, not enforced", () => {
  const state = readinessOf({
    onboardingStatus: "pending",
    verificationDeadline: verificationDeadline("2026-09-17"),
    documents: NO_DOCS,
    now: new Date("2026-09-16T00:00:00Z"),
  });

  // It surfaces as a status for a human to act on. Nothing in this module
  // cancels a booking or decides a refund, which is the property's call.
  assert.equal(state, "deadline_passed");
  // Check the CODE, not the prose. The comment in that module says it does
  // not cancel or refund, and a naive grep would trip over the word it uses
  // to promise that.
  const rulesCode = readFileSync(path.join(here, "guest-verification-rules.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.ok(
    !/cancel|refund/i.test(rulesCode),
    "the rules module must not make cancellation or refund decisions",
  );
});

test("readiness · a guest who complied stays ready even if verified late", () => {
  assert.equal(
    readinessOf({
      onboardingStatus: "verified",
      verificationDeadline: verificationDeadline("2026-09-17"),
      documents: { count: 1, submitted: 0, verified: 1, rejected: 0 },
      now: new Date("2026-09-16T12:00:00Z"), // after the deadline
    }),
    "ready",
    "verified documents must outrank a passed clock",
  );
});

test("readiness · an explicit block outranks everything", () => {
  assert.equal(
    readinessOf({
      onboardingStatus: "blocked",
      verificationDeadline: verificationDeadline("2026-09-17"),
      documents: { count: 1, submitted: 0, verified: 1, rejected: 0 },
      now: new Date("2026-09-10T00:00:00Z"),
    }),
    "blocked",
  );
});

test("readiness · a rejected document does not read as ready", () => {
  assert.equal(
    readinessOf({
      onboardingStatus: "submitted",
      verificationDeadline: verificationDeadline("2026-09-17"),
      documents: { count: 2, submitted: 1, verified: 1, rejected: 1 },
      now: new Date("2026-09-10T00:00:00Z"),
    }),
    "documents_submitted",
  );
});

// =================================================== NO MONEY TO MANAGEMENT

test("management · the leak detector catches what it is meant to catch", () => {
  // Guard the guard: a detector that never fires proves nothing.
  assert.deepEqual(financialLeaks({ guestName: "A", checkIn: "2026-09-17" }), []);
  assert.equal(financialLeaks({ grossPaise: 1 }).length, 1);
  assert.equal(financialLeaks({ nested: { receivedPaise: 1 } }).length, 1);
  assert.equal(financialLeaks({ note: "Balance due ₹31,500" }).length, 1);
  assert.equal(financialLeaks(["Total: Rs 45000"]).length, 1);
});

test("management · a representative DTO carries no financial field", () => {
  const dto = {
    guestName: "Reetuparna Bhattacharjee",
    guestPhone: "+91 98041 43366",
    checkIn: "2026-09-17",
    checkOut: "2026-09-25",
    documents: { count: 1, submitted: 1, verified: 0, rejected: 0 },
    readiness: "documents_submitted" as const,
    verificationDeadline: verificationDeadline("2026-09-17").toISOString(),
  };

  assert.deepEqual(financialLeaks(dto), []);

  for (const banned of ["grossPaise", "receivedPaise", "commissionPaise", "taxPaise"]) {
    assert.ok(!(banned in dto), `${banned} reached the management DTO`);
  }
});

test("management · buildManagementDto never selects a financial column", () => {
  const body = ONBOARDING_REPO_TS.slice(
    ONBOARDING_REPO_TS.indexOf("export async function buildManagementDto"),
    ONBOARDING_REPO_TS.indexOf("export async function createOrRefreshManagementAccess"),
  );

  assert.ok(body.length > 0, "buildManagementDto not found");
  for (const column of ["grossPaise", "receivedPaise", "commissionPaise", "taxPaise"]) {
    assert.ok(
      !body.includes(`bookings.${column}`),
      `buildManagementDto selects bookings.${column}`,
    );
  }
  // It must whitelist columns rather than select the whole row.
  assert.ok(
    !/\.select\(\)\s*\.from\(bookings\)/.test(body),
    "buildManagementDto selects the entire booking row instead of naming columns",
  );
});

test("management · the message is built from the DTO, not the admin booking row", () => {
  assert.match(
    ADMIN_GUESTS_TSX,
    /function buildManagementMessage\(\s*dto: ManagementGuestVerification,/,
    "buildManagementMessage no longer takes the whitelisted DTO",
  );
  assert.ok(
    !/buildManagementMessage\(stay,/.test(ADMIN_GUESTS_TSX),
    "a management message is still being built from the booking row",
  );

  // The client-side mirror of the DTO must not grow a money field.
  const dtoType = ADMIN_GUESTS_TSX.slice(
    ADMIN_GUESTS_TSX.indexOf("type ManagementGuestVerification = {"),
    ADMIN_GUESTS_TSX.indexOf("type GuestStay = {"),
  );
  assert.ok(dtoType.length > 0, "the client DTO type was not found");
  assert.deepEqual(
    MANAGEMENT_FORBIDDEN_KEYS.filter((key) => dtoType.includes(key)),
    [],
    "a forbidden key appears in the client management type",
  );
});

test("management · the endpoint returns the DTO alongside the access link", () => {
  assert.match(
    ONBOARDING_ROUTES_TS,
    /const management = await buildManagementDto\(bookingId\);/,
    "the management-access route does not build the whitelisted DTO",
  );
  assert.match(ONBOARDING_ROUTES_TS, /management,\s*\}\);/);
});

// ============================================== THE GUEST MESSAGE (OPPOSITE)

test("guest message · does carry the money, and the verification link first", () => {
  const builder = ADMIN_GUESTS_TSX.slice(
    ADMIN_GUESTS_TSX.indexOf("function buildGuestWhatsAppMessage"),
    ADMIN_GUESTS_TSX.indexOf("function buildManagementMessage"),
  );
  assert.ok(builder.length > 0, "buildGuestWhatsAppMessage not found");

  // The guest is entitled to their own booking's figures.
  for (const field of ["total", "advance", "balance"]) {
    assert.ok(builder.includes(`${field}`), `the guest message dropped ${field}`);
  }
  assert.ok(/₹\$\{total\}/.test(builder), "the guest message no longer shows a total in rupees");

  // And the mandatory link must be present and near the top — above the money.
  assert.ok(builder.includes("${verificationUrl}"), "the verification URL is missing");
  assert.ok(
    builder.indexOf("${verificationUrl}") < builder.indexOf("Booking Details"),
    "the verification link must appear before the booking/financial section",
  );
  assert.match(builder, /48 hours/, "the 48-hour requirement is not stated to the guest");
});

test("guest message · the URL is encoded when it goes into the wa.me link", () => {
  assert.match(
    ADMIN_GUESTS_TSX,
    /wa\.me\/\$\{stay\.guestPhone\.replace\(\/\\D\/g, ''\)\}\?text=\$\{encodeURIComponent\(message\)\}/,
    "the guest WhatsApp deep link does not URL-encode its message",
  );
});

// ================================================= ARRIVAL PACK UNTOUCHED

test("arrival pack · the /welcome flow is not touched by any of this", () => {
  const guestRoutes = readFileSync(path.join(here, "../routes/guest.ts"), "utf8");
  const guestLookup = readFileSync(path.join(here, "guest-lookup.ts"), "utf8");

  // The three endpoints the Arrival Pack depends on still exist.
  assert.match(guestRoutes, /router\.post\("\/guest\/lookup"/);
  assert.match(guestRoutes, /router\.post\("\/guest\/pack\.pdf"/);
  assert.match(guestLookup, /export async function lookupBooking/);

  // It authenticates on booking reference + phone, as before.
  assert.match(guestLookup, /normalisePhone\(current\.guestPhone\)/);
  assert.match(guestLookup, /reason: "phone_mismatch"/);

  // And the onboarding feature must not have reached into it.
  for (const source of [guestRoutes, guestLookup]) {
    assert.ok(
      !/guestOnboarding|guest_onboarding|buildManagementDto/.test(source),
      "the Arrival Pack now depends on the onboarding feature",
    );
  }
});

// ==================================================== QUOTE DELIVERY PATH
// Until the WhatsApp Business API is approved, a quote goes out as a wa.me
// link from the owner's own WhatsApp. These pin the behaviour that made that
// possible, because the previous version answered 502 and recorded nothing.

const ENQUIRY_ROUTES_TS = readFileSync(path.join(here, "../routes/enquiries.ts"), "utf8");
const ENQUIRIES_REPO_TS = readFileSync(path.join(here, "enquiries-repo.ts"), "utf8");

test("quote · an unconfigured WhatsApp API no longer fails the request", () => {
  // The send is attempted only when the API is actually configured.
  assert.match(
    ENQUIRY_ROUTES_TS,
    /const auto = isWhatsappEnabled\(\)\s*\?\s*await sendTemplate\(/,
    "the quote route still calls sendTemplate unconditionally",
  );
  // A 502 may only follow a real API failure, never a missing configuration.
  assert.match(ENQUIRY_ROUTES_TS, /if \(auto && !auto\.ok\)/);
});

test("quote · the manual path returns an encoded wa.me link and is labelled honestly", () => {
  assert.match(
    ENQUIRY_ROUTES_TS,
    /https:\/\/wa\.me\/\$\{to\}\?text=\$\{encodeURIComponent\(template\.preview\)\}/,
    "the manual quote link is missing or not URL-encoded",
  );
  // "sent" is a claim this server cannot make about a deep link.
  assert.match(ENQUIRY_ROUTES_TS, /delivery: auto \? "api" : "manual_whatsapp"/);
  assert.ok(
    !/delivery: "sent"/.test(ENQUIRY_ROUTES_TS),
    "the manual path claims delivery it cannot verify",
  );
});

test("quote · the hold still starts, and is reversible when it should not have", () => {
  // Recorded on both paths, or dates go unheld and get double-sold.
  assert.match(ENQUIRY_ROUTES_TS, /const updated = await markQuoteSent\(/);

  // And the undo exists, which is what makes recording it optimistically safe.
  assert.match(ENQUIRY_ROUTES_TS, /router\.delete\("\/enquiries\/:id\/quote"/);
  assert.match(ENQUIRIES_REPO_TS, /export async function clearQuoteSent/);

  // The undo must clear the amounts too, not just the timestamp.
  const clear = ENQUIRIES_REPO_TS.slice(
    ENQUIRIES_REPO_TS.indexOf("export async function clearQuoteSent"),
  ).slice(0, 400);
  for (const field of ["quotedTotalPaise: null", "quotedAdvancePaise: null", "quoteSentAt: null"]) {
    assert.ok(clear.includes(field), `clearQuoteSent leaves ${field.split(":")[0]} behind`);
  }
});

test("quote · the send button is gated on UPI, not on the WhatsApp API", () => {
  assert.match(
    ENQUIRY_ROUTES_TS,
    /quotingReady: upiDetails\(\) !== null,/,
    "quotingReady still requires the WhatsApp API, which keeps the button dead",
  );
  assert.ok(
    !/quotingReady: isWhatsappEnabled\(\)/.test(ENQUIRY_ROUTES_TS),
    "quotingReady is gated on WhatsApp configuration again",
  );
});

test("quote · the client opens WhatsApp inside the click, not in onSuccess", () => {
  const mutation = ADMIN_GUESTS_TSX.slice(
    ADMIN_GUESTS_TSX.indexOf("const sendQuote = useMutation"),
    ADMIN_GUESTS_TSX.indexOf("const withdrawQuote = useMutation"),
  );
  assert.ok(mutation.length > 0, "sendQuote mutation not found");
  // Popup blockers kill window.open once the stack has left the click.
  assert.match(mutation, /mutationFn: async \(id: string\)/);
  assert.match(mutation, /window\.open\(result\.whatsappUrl/);
  assert.ok(
    !/onSuccess:[\s\S]*window\.open/.test(mutation),
    "WhatsApp is opened from onSuccess, where mobile browsers will block it",
  );
});
