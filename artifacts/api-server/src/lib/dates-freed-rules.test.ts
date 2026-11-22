import assert from "node:assert/strict";
import { test } from "node:test";

import { freedDatesPlan, type FreedCandidate } from "./dates-freed-rules.ts";

const now = new Date("2026-11-22T06:00:00Z");
const today = "2026-11-22";
const enquiry = (id: string, over: Partial<FreedCandidate> = {}): FreedCandidate => ({
  id,
  status: "new",
  checkIn: "2026-12-17",
  checkOut: "2026-12-19",
  convertedBookingId: null,
  createdAt: "2026-11-20T10:00:00Z",
  quoteSentAt: null,
  advancePaidAt: null,
  ...over,
});
const booked = { source: "airbnb", startDate: "2026-12-16", endDate: "2026-12-18" };

test("a clash is remembered once, and nobody is told while the nights are still taken", () => {
  const plan = freedDatesPlan({ enquiries: [enquiry("a")], taken: [booked], waitlist: new Map(), today, now });
  assert.deepEqual(plan, { markTaken: ["a"], notify: [] });

  const again = freedDatesPlan({ enquiries: [enquiry("a")], taken: [booked], waitlist: new Map([["a", { notifiedAt: null }]]), today, now });
  assert.deepEqual(again, { markTaken: [], notify: [] });
});

test("freed nights go to the oldest waiting enquiry only, once", () => {
  const enquiries = [enquiry("late", { createdAt: "2026-11-21T10:00:00Z" }), enquiry("early")];
  const waitlist = new Map([["late", { notifiedAt: null }], ["early", { notifiedAt: null }]]);
  assert.deepEqual(freedDatesPlan({ enquiries, taken: [], waitlist, today, now }).notify, ["early"]);

  const told = new Map([["late", { notifiedAt: null }], ["early", { notifiedAt: now }]]);
  const heldForEarly = [enquiry("late", { createdAt: "2026-11-21T10:00:00Z" }), enquiry("early", { quoteSentAt: now })];
  assert.deepEqual(freedDatesPlan({ enquiries: heldForEarly, taken: [], waitlist: told, today, now }).notify, [], "the first guest's 24-hour hold keeps the second waiting");

  const expired = [enquiry("late", { createdAt: "2026-11-21T10:00:00Z" }), enquiry("early", { quoteSentAt: "2026-11-20T00:00:00Z" })];
  assert.deepEqual(freedDatesPlan({ enquiries: expired, taken: [], waitlist: told, today, now }).notify, ["late"], "after the hold runs out, the next guest is told");
});

test("never for closed, converted, past or old enquiries, or ones never told the dates were taken", () => {
  const waitlist = new Map(["closed", "converted", "past", "old"].map((id) => [id, { notifiedAt: null }]));
  const enquiries = [
    enquiry("closed", { status: "closed" }),
    enquiry("converted", { convertedBookingId: "b1" }),
    enquiry("past", { checkIn: "2026-11-22", checkOut: "2026-11-23" }),
    enquiry("old", { createdAt: "2026-08-01T00:00:00Z" }),
    enquiry("never-clashed"),
  ];
  assert.deepEqual(freedDatesPlan({ enquiries, taken: [], waitlist, today, now }).notify, []);
});
