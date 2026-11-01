import assert from "node:assert/strict";
import test from "node:test";

import { bookingCaretakerCards, type AlertBooking, type CaretakerMessageState } from "./caretaker-rules.ts";

const booking = (over: Partial<AlertBooking> = {}): AlertBooking => ({
  id: "b1",
  source: "airbnb",
  status: "confirmed",
  guestName: "Ritika Sen",
  guestPhone: "+91 98300 11223",
  checkIn: "2026-11-14",
  checkOut: "2026-11-16",
  guests: 3,
  pets: 1,
  grossPaise: 1_200_000,
  receivedPaise: 0,
  createdAt: new Date("2026-09-01T06:00:00Z"),
  ...over,
});
const sent = (at = "2026-11-01T06:00:00Z"): CaretakerMessageState => ({ status: "sent", at: new Date(at), how: "manual" });
const NOW = new Date("2026-11-01T06:00:00Z"); // 11:30 am IST, 1 Nov

test("caretaker cards · every upcoming booking gets a card, even when nothing is due", () => {
  // Booked two months ago, so the queue would show nothing for it today.
  const [card] = bookingCaretakerCards([booking()], new Map(), NOW);
  assert.ok(card);
  assert.equal(card.when, "In 13 days");
  assert.equal(card.suggested, "new_booking");
  assert.deepEqual(card.messages.map((m) => m.kind), ["new_booking", "checkin_eve", "checkout_eve"]);
  assert.equal(card.source, "Airbnb");
  for (const m of card.messages) assert.doesNotMatch(m.text, /₹|12,000|1200000/);
});

test("caretaker cards · once told, nothing is pushed, but she can be told again", () => {
  const [card] = bookingCaretakerCards([booking()], new Map([["b1:new_booking", sent()]]), NOW);
  assert.equal(card!.suggested, null);
  assert.equal(card!.messages[0]!.done?.status, "sent");
});

test("caretaker cards · the day before arrival offers the arrival reminder first", () => {
  const eve = new Date("2026-11-13T05:00:00Z"); // 10:30 am IST
  const [card] = bookingCaretakerCards([booking()], new Map([["b1:new_booking", sent()]]), eve);
  assert.equal(card!.when, "Arrives tomorrow");
  assert.equal(card!.suggested, "checkin_eve");
});

test("caretaker cards · a stay in progress drops the arrival message", () => {
  const during = new Date("2026-11-14T10:00:00Z");
  const [card] = bookingCaretakerCards([booking()], new Map([["b1:new_booking", sent()]]), during);
  assert.equal(card!.when, "Staying now");
  assert.deepEqual(card!.messages.map((m) => m.kind), ["new_booking", "checkout_eve"]);
});

test("caretaker cards · ended, pending and untold-cancelled bookings are left out; told-cancelled offers the cancellation", () => {
  const cards = bookingCaretakerCards(
    [
      booking({ id: "old", checkIn: "2026-10-20", checkOut: "2026-10-22" }),
      booking({ id: "hold", status: "pending" }),
      booking({ id: "quiet", status: "cancelled" }),
      booking({ id: "told", status: "cancelled", checkIn: "2026-11-05", checkOut: "2026-11-06" }),
    ],
    new Map([["told:new_booking", sent()]]),
    NOW,
  );
  assert.deepEqual(cards.map((c) => c.bookingId), ["told"]);
  assert.equal(cards[0]!.suggested, "cancelled");
  assert.deepEqual(cards[0]!.messages.map((m) => m.kind), ["cancelled"]);
});

test("caretaker cards · sorted by arrival", () => {
  const cards = bookingCaretakerCards(
    [booking({ id: "late", checkIn: "2026-12-01", checkOut: "2026-12-03" }), booking({ id: "soon", checkIn: "2026-11-02", checkOut: "2026-11-03" })],
    new Map(),
    NOW,
  );
  assert.deepEqual(cards.map((c) => c.bookingId), ["soon", "late"]);
  assert.equal(cards[0]!.when, "Arrives tomorrow");
});
