import { test } from "node:test";
import assert from "node:assert/strict";
import {
  documentLabel,
  extraGuestPerNightPaise,
  maxCards,
  partyProblem,
  requiredSides,
  type GuestSlotInput,
} from "./guest-id-rules.ts";

const card = (slot: number, over: Partial<GuestSlotInput> = {}): GuestSlotInput => ({
  slot,
  name: `Guest ${slot} Name`,
  age: "adult",
  idType: "aadhaar",
  foreign: false,
  files: [{ side: "Front" }, { side: "Back" }],
  ...over,
});

test("each ID type asks for the right photos", () => {
  assert.deepEqual(requiredSides("aadhaar", false), ["Front", "Back"]);
  assert.deepEqual(requiredSides("passport", false), ["Photo page"]);
  assert.deepEqual(requiredSides("passport", true), ["Photo page", "Indian visa"]);
  assert.deepEqual(requiredSides("school", false), ["Front"]);
});

test("the number of IDs must cover every booked guest", () => {
  assert.equal(partyProblem({ booked: 3, keptSlots: [], slots: [card(1), card(2), card(3)] }), null);
  assert.match(partyProblem({ booked: 3, keptSlots: [], slots: [card(1), card(2)] })!, /booking is for 3 guests\. Add an ID for Guest 3/);
});

test("accepted guests count toward the party on a re-upload", () => {
  assert.equal(partyProblem({ booked: 3, keptSlots: [1, 3], slots: [card(2)] }), null);
  assert.match(partyProblem({ booked: 3, keptSlots: [1], slots: [card(2)] })!, /Guest 3/);
  assert.match(partyProblem({ booked: 2, keptSlots: [1], slots: [card(1)] })!, /twice/);
});

test("a two-sided ID needs both sides, once each", () => {
  assert.match(partyProblem({ booked: 1, keptSlots: [], slots: [card(1, { files: [{ side: "Front" }] })] })!, /back of Guest 1 Name's Aadhaar/);
  assert.match(partyProblem({ booked: 1, keptSlots: [], slots: [card(1, { files: [{ side: "Front" }, { side: "Front" }, { side: "Back" }] })] })!, /Only one front/);
  assert.match(partyProblem({ booked: 1, keptSlots: [], slots: [card(1, { idType: "passport", foreign: true, files: [{ side: "Photo page" }] })] })!, /indian visa/);
});

test("children upload an ID too, from the child list", () => {
  assert.equal(partyProblem({ booked: 1, keptSlots: [], slots: [card(1, { age: "child", idType: "school", files: [{ side: "Front" }] })] }), null);
  assert.match(partyProblem({ booked: 1, keptSlots: [], slots: [card(1, { age: "child", idType: "dl" })] })!, /not accepted for a child/);
  assert.match(partyProblem({ booked: 1, keptSlots: [], slots: [card(1, { age: "adult", idType: "school", files: [{ side: "Front" }] })] })!, /not accepted for an adult/);
});

test("names and ID types are required", () => {
  assert.match(partyProblem({ booked: 1, keptSlots: [], slots: [card(1, { name: " " })] })!, /full name/);
  assert.match(partyProblem({ booked: 1, keptSlots: [], slots: [card(1, { idType: "ration" })] })!, /Choose an ID type/);
});

test("extra guests are allowed up to a cap", () => {
  assert.equal(maxCards(4), 7);
  assert.equal(maxCards(6), 8);
  assert.equal(partyProblem({ booked: 2, keptSlots: [], slots: [card(1), card(2), card(3)] }), null);
  assert.match(partyProblem({ booked: 2, keptSlots: [], slots: [card(1), card(2), card(6)] })!, /not a guest/);
});

test("extra-guest charge follows the ladder, then the extra-adult rate", () => {
  const rates = { includedGuests: 2, ladderPaise: 20_000, ladderMax: 5, abovePaise: 55_000 };
  assert.equal(extraGuestPerNightPaise(4, 4, rates), 0);
  assert.equal(extraGuestPerNightPaise(4, 5, rates), 20_000);
  assert.equal(extraGuestPerNightPaise(4, 6, rates), 75_000);
  assert.equal(extraGuestPerNightPaise(1, 3, rates), 20_000);
});

test("document label names the guest, ID and side", () => {
  assert.equal(documentLabel(2, "aadhaar", "Back", " Riya Sen "), "Guest 2 · Aadhaar · Back – Riya Sen");
});
