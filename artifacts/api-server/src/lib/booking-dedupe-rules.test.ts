import { test } from "node:test";
import assert from "node:assert/strict";

import {
  duplicateGroups,
  phoneKey,
  planConversion,
  planStart,
  samePerson,
  survivorFor,
  unpaidToRelease,
  type BookingLite,
  type OwnHold,
} from "./booking-dedupe-rules.ts";
import { startHold, type StartStore } from "./book-pay-start.ts";
import { DEFAULT_BOOK_PAY_SETTINGS } from "./book-pay-rules.ts";

const NOW = new Date("2026-10-28T08:00:00Z");

const booking = (over: Partial<BookingLite>): BookingLite => ({
  id: "b1",
  reference: "RK-16NOV-AAAAA",
  status: "confirmed",
  source: "direct",
  guestName: "Prasun Singha Roy",
  guestPhone: "+91 89616 80600",
  checkIn: "2026-11-16",
  checkOut: "2026-11-18",
  receivedPaise: 355000,
  createdAt: new Date("2026-10-24T09:00:00Z"),
  ...over,
});

const stay = { name: "Prasun Singha Roy", phone: "8961680600", checkIn: "2026-11-16", checkOut: "2026-11-18" };

/* ------------------------------ people ------------------------------ */

test("phones compare on the last ten digits", () => {
  assert.equal(phoneKey("+91 89616 80600"), "8961680600");
  assert.equal(phoneKey("08961680600"), "8961680600");
  assert.equal(phoneKey("12345"), "");
});

test("same person: same number, or the same name when a number is missing", () => {
  assert.equal(samePerson({ phone: "+918961680600", name: "P Roy" }, { phone: "8961680600", name: "Prasun" }), true);
  assert.equal(samePerson({ phone: "9830040042", name: "Prasun" }, { phone: "8961680600", name: "Prasun" }), false);
  assert.equal(samePerson({ phone: null, name: "Rana Datta" }, { phone: "9830040042", name: "rana  datta" }), true);
});

/* ---------------------------- conversion ---------------------------- */

test("conversion: no advance, no booking", () => {
  assert.equal(planConversion({ paid: false, stay, existing: [] }).kind, "refuse_unpaid");
});

test("conversion: the guest already has a confirmed booking on these nights -> link, never a second", () => {
  const plan = planConversion({ paid: true, stay, existing: [booking({})] });
  assert.equal(plan.kind, "link");
  if (plan.kind === "link") assert.equal(plan.booking.id, "b1");
});

test("conversion: the guest's own unpaid booking on these nights is released first", () => {
  const plan = planConversion({ paid: true, stay, existing: [booking({ status: "pending", receivedPaise: null })] });
  assert.equal(plan.kind, "create");
  if (plan.kind === "create") assert.deepEqual(plan.release.map((b) => b.id), ["b1"]);
});

test("conversion: someone else's booking is not this guest's — left to the clash check", () => {
  const plan = planConversion({ paid: true, stay, existing: [booking({ guestPhone: "9830040042", guestName: "Rana Datta" })] });
  assert.equal(plan.kind, "create");
  if (plan.kind === "create") assert.equal(plan.release.length, 0);
});

/* --------------------------- Book & Pay start --------------------------- */

const hold = (over: Partial<OwnHold> = {}): OwnHold => ({
  paymentRequestId: "pay-1",
  enquiryId: "enq-1",
  reference: "RK-16NOV-HOLD1",
  status: "awaiting_payment",
  checkIn: "2026-11-16",
  checkOut: "2026-11-18",
  adults: 2,
  children: 0,
  pets: 0,
  holdExpiresAt: new Date(NOW.getTime() + 20 * 60_000),
  totalPaise: 640000,
  advancePaise: 320000,
  ...over,
});

const party = { checkIn: "2026-11-16", checkOut: "2026-11-18", adults: 2, children: 0, pets: 0 };

test("start: same guest, same stay -> resume the hold they have", () => {
  const plan = planStart([hold()], party);
  assert.equal(plan.kind, "resume");
});

test("start: same guest, different dates -> release the abandoned unpaid hold", () => {
  const plan = planStart([hold()], { ...party, checkIn: "2026-11-20", checkOut: "2026-11-22" });
  assert.equal(plan.kind, "new");
  if (plan.kind === "new") assert.deepEqual(plan.release.map((h) => h.paymentRequestId), ["pay-1"]);
});

test("start: a hold with a UTR submitted is never released by the guest starting again", () => {
  const plan = planStart([hold({ status: "submitted" })], { ...party, checkIn: "2026-11-20", checkOut: "2026-11-22" });
  assert.equal(plan.kind, "new");
  if (plan.kind === "new") assert.equal(plan.release.length, 0);
});

test("startHold: resuming hands back the same reference under a new link, no second hold", async () => {
  const created: string[] = [];
  const resumed: string[] = [];
  const store: StartStore<null> = {
    withLock: (work) => work(null),
    takenRanges: async () => [{ startDate: "2026-11-16", endDate: "2026-11-18" }],
    createHold: async () => {
      created.push("x");
      return { enquiryId: "enq-2", paymentRequestId: "pay-2" };
    },
    ownLiveHolds: async () => [hold()],
    resumeHold: async (_tx, id) => {
      resumed.push(id);
    },
    releaseHold: async () => undefined,
  };
  const input = { name: "Prasun", phone: "8961680600", email: null, requests: null, ...party };
  const quote = { ok: true, totalPaise: 640000, advancePaise: 320000 } as never;
  const result = await startHold(store, input, quote, DEFAULT_BOOK_PAY_SETTINGS, NOW, "2026-10-28");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.resumed, true);
    assert.equal(result.reference, "RK-16NOV-HOLD1");
  }
  assert.deepEqual(resumed, ["pay-1"]);
  assert.equal(created.length, 0);
});

/* ------------------------------- sweep ------------------------------- */

test("sweep: unpaid own bookings past the hold are released; paid, OTA and recent ones are not", () => {
  const old = new Date(NOW.getTime() - 30 * 3_600_000);
  const fresh = new Date(NOW.getTime() - 2 * 3_600_000);
  const rows = [
    booking({ id: "release", status: "pending", receivedPaise: null, createdAt: old }),
    booking({ id: "paid", status: "pending", receivedPaise: 100000, createdAt: old }),
    booking({ id: "recent", status: "pending", receivedPaise: null, createdAt: fresh }),
    booking({ id: "ota", status: "pending", receivedPaise: null, createdAt: old, source: "bookingCom" }),
    booking({ id: "confirmed", status: "confirmed", receivedPaise: null, createdAt: old }),
  ];
  assert.deepEqual(unpaidToRelease(rows, NOW, 24).map((b) => b.id), ["release"]);
});

test("duplicates: same number and dates -> keep the confirmed copy with onboarding", () => {
  const groups = duplicateGroups([
    booking({ id: "a", reference: "RK-16NOV-KK79J", status: "pending", receivedPaise: null }),
    booking({ id: "b", reference: "RK-16NOV-GOOD1", hasOnboarding: true }),
    booking({ id: "other", guestPhone: "9830040042", guestName: "Rana Datta", checkIn: "2026-11-18", checkOut: "2026-11-20" }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.survivor.id, "b");
  assert.deepEqual(groups[0]!.duplicates.map((d) => d.id), ["a"]);
});

test("duplicates: OTA bookings and different dates are never merged", () => {
  assert.equal(
    duplicateGroups([booking({ id: "a" }), booking({ id: "b", checkIn: "2026-11-17" })]).length,
    0,
  );
  assert.equal(
    duplicateGroups([booking({ id: "a", source: "bookingCom" }), booking({ id: "b", source: "bookingCom" })]).length,
    0,
  );
});

test("named duplicate: merged only when another copy of the stay exists", () => {
  const dup = booking({ id: "dup", reference: "RK-16NOV-KK79J" });
  assert.equal(survivorFor(dup, [dup]), null);
  assert.equal(survivorFor(dup, [dup, booking({ id: "keep" })])?.id, "keep");
  assert.equal(survivorFor(dup, [dup, booking({ id: "cancelled", status: "cancelled" })]), null);
});
