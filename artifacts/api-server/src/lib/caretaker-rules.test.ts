import assert from "node:assert/strict";
import test from "node:test";

import { alertText, dueAlerts, istAt, toE164, type AlertBooking } from "./caretaker-rules.ts";

const booking = (over: Partial<AlertBooking> = {}): AlertBooking => ({
  id: "b1",
  source: "bookingCom",
  status: "confirmed",
  guestName: "Ayush Dhar",
  guestPhone: "+91 98339 42336",
  checkIn: "2026-10-23",
  checkOut: "2026-10-24",
  guests: 4,
  pets: 0,
  grossPaise: 510_300,
  receivedPaise: null,
  createdAt: new Date("2026-10-22T07:06:00Z"), // 12:36 pm IST
  ...over,
});
const none = new Set<string>();
const kinds = (list: ReturnType<typeof dueAlerts>) => list.map((a) => a.kind).sort();

test("caretaker · a new booking alerts at once, with the balance to collect", () => {
  const due = dueAlerts([booking()], none, new Date("2026-10-22T08:00:00Z"));
  assert.deepEqual(kinds(due), ["new_booking"]);
  assert.match(due[0]!.text, /NEW BOOKING/);
  assert.match(due[0]!.text, /Ayush Dhar \(4 guests\)/);
  assert.match(due[0]!.text, /Collect at check-in: ₹5,103/);
  assert.match(due[0]!.text, /98339 42336/);
});

test("caretaker · no check-in reminder for a booking made after its 10 am slot", () => {
  // Booked 12:36 pm the day before arrival: the new-booking alert covers it.
  const due = dueAlerts([booking()], new Set(["b1:new_booking"]), new Date("2026-10-22T12:00:00Z"));
  assert.deepEqual(kinds(due), []);
});

test("caretaker · day-before reminders at 10 am IST, not before, not after the moment", () => {
  const b = booking({ checkIn: "2026-11-05", checkOut: "2026-11-07", createdAt: new Date("2026-10-01T00:00:00Z") });
  assert.deepEqual(kinds(dueAlerts([b], none, istAt("2026-11-04", 9))), []);
  assert.deepEqual(kinds(dueAlerts([b], none, istAt("2026-11-04", 10))), ["checkin_eve"]);
  assert.deepEqual(kinds(dueAlerts([b], new Set(["b1:checkin_eve"]), istAt("2026-11-04", 15))), []);
  assert.deepEqual(kinds(dueAlerts([b], none, istAt("2026-11-06", 10))), ["checkout_eve"]);
  // Too late: it is check-out morning already.
  assert.deepEqual(kinds(dueAlerts([b], none, new Date(istAt("2026-11-07", 11).getTime() + 60_000))), []);
});

test("caretaker · nothing during quiet hours (9 pm – 8 am IST)", () => {
  assert.deepEqual(dueAlerts([booking({ createdAt: istAt("2026-10-22", 22) })], none, istAt("2026-10-22", 23)), []);
  assert.deepEqual(kinds(dueAlerts([booking({ createdAt: istAt("2026-10-22", 22) })], none, istAt("2026-10-23", 8))), ["new_booking"]);
});

test("caretaker · old or imported bookings never page anyone as 'new'", () => {
  const imported = booking({ checkIn: "2026-08-01", checkOut: "2026-08-03", createdAt: new Date("2026-10-22T07:00:00Z") });
  assert.deepEqual(dueAlerts([imported], none, new Date("2026-10-22T08:00:00Z")), []);
  const older = booking({ checkIn: "2026-12-01", checkOut: "2026-12-03", createdAt: new Date("2026-10-01T00:00:00Z") });
  assert.deepEqual(dueAlerts([older], none, new Date("2026-10-22T08:00:00Z")), []);
});

test("caretaker · a cancellation is sent only if they were told about the booking", () => {
  const cancelled = booking({ status: "cancelled", checkIn: "2026-11-05", checkOut: "2026-11-07" });
  const at = new Date("2026-10-23T08:00:00Z");
  assert.deepEqual(dueAlerts([cancelled], none, at), []);
  assert.deepEqual(kinds(dueAlerts([cancelled], new Set(["b1:new_booking"]), at)), ["cancelled"]);
  assert.match(alertText("cancelled", cancelled), /No need to prepare/);
});

test("caretaker · pending bookings wait; fully paid says so", () => {
  assert.deepEqual(dueAlerts([booking({ status: "pending" })], none, new Date("2026-10-22T08:00:00Z")), []);
  assert.match(alertText("new_booking", booking({ receivedPaise: 510_300 })), /Fully paid/);
});

test("caretaker · numbers normalise to E.164", () => {
  assert.equal(toE164("+91 78726 85558"), "+917872685558");
  assert.equal(toE164("7872685558"), "+917872685558");
  assert.equal(toE164("07872685558"), "+917872685558");
  assert.equal(toE164("123"), null);
});

test("caretaker · manual queue ignores quiet hours and keeps a new booking for a week", () => {
  const late = istAt("2026-10-22", 23);
  assert.deepEqual(kinds(dueAlerts([booking()], none, late, { manual: true })), ["new_booking"]);
  const b = booking({ checkIn: "2026-11-20", checkOut: "2026-11-22", createdAt: new Date("2026-10-20T06:00:00Z") });
  const threeDaysLater = new Date("2026-10-23T06:00:00Z");
  assert.deepEqual(kinds(dueAlerts([b], none, threeDaysLater)), []);
  assert.deepEqual(kinds(dueAlerts([b], none, threeDaysLater, { manual: true })), ["new_booking"]);
});
