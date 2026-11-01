import assert from "node:assert/strict";
import test from "node:test";

import {
  checkinTomorrowAlert,
  eventForActivity,
  holdAlert,
  isEveningRun,
  istTomorrow,
  reviewAlert,
  utrAlert,
} from "./owner-alert-rules.ts";
import { chunk, deadTokens, expoMessages } from "./expo-push-rules.ts";
import { OWNER_EVENTS, applySettingsPatch, eventEnabled, inQuietHours, settingsView } from "./owner-settings-rules.ts";

test("alert text: short, specific, with what to do next", () => {
  assert.deepEqual(
    holdAlert({ guestName: "Ananya Sen", checkIn: "2026-12-15", checkOut: "2026-12-17", advancePaise: 370000, payBy: new Date("2026-11-01T13:15:00Z") }),
    { title: "New booking: Ananya Sen", body: "15 Dec → 17 Dec · ₹3,700 advance due by 6:45 pm. Payment pending." },
  );
  assert.match(utrAlert({ guestName: "A", checkIn: "2026-12-15", checkOut: "2026-12-17", advancePaise: 370000, utr: "123456789012", hasScreenshot: true }).body, /₹3,700 advance · UTR 123456789012 \+ screenshot · 15 Dec → 17 Dec\. Check the bank, then confirm\./);
  assert.equal(reviewAlert({ reviewerName: "Rana", rating: 5, text: "Lovely   stay" }).title, "5★ Google review from Rana");
  assert.match(reviewAlert({ reviewerName: null, rating: 4, text: "x".repeat(300) }).body, /…$/);
  assert.deepEqual(checkinTomorrowAlert({ guestName: null, source: "bookingCom", checkIn: "2026-11-02", checkOut: "2026-11-04", guests: 2 }), {
    title: "Check-in tomorrow: A guest",
    body: "2 Nov → 4 Nov · 2 guests · Booking.com",
  });
});

test("which activity becomes which alert; the owner's own website bookings are not pushed again", () => {
  assert.equal(eventForActivity({ kind: "booking_new", source: "airbnb" }), "ota_booking");
  assert.equal(eventForActivity({ kind: "booking_new", source: "direct" }), null);
  assert.equal(eventForActivity({ kind: "ota_block", source: "bookingCom" }), "ota_booking");
  assert.equal(eventForActivity({ kind: "booking_cancelled", source: "direct" }), "ota_cancellation");
  assert.equal(eventForActivity({ kind: "documents_uploaded" }), "documents_uploaded");
  assert.equal(eventForActivity({ kind: "payment" }), null, "Book & Pay alerts where it happens");
});

test("evening check-in run and 'tomorrow' are in India time", () => {
  assert.equal(isEveningRun(new Date("2026-11-01T12:29:00Z")), false); // 17:59 IST
  assert.equal(isEveningRun(new Date("2026-11-01T12:30:00Z")), true); // 18:00 IST
  assert.equal(istTomorrow(new Date("2026-11-01T19:00:00Z")), "2026-11-03", "00:30 IST on the 2nd: tomorrow is the 3rd");
});

test("quiet hours: across midnight, IST, and silent rather than missing", () => {
  const q = { start: "22:00", end: "07:00" };
  assert.ok(inQuietHours(q, new Date("2026-11-01T17:00:00Z"))); // 22:30 IST
  assert.ok(inQuietHours(q, new Date("2026-11-01T01:00:00Z"))); // 06:30 IST
  assert.ok(!inQuietHours(q, new Date("2026-11-01T02:00:00Z"))); // 07:30 IST
  assert.ok(!inQuietHours(null, new Date()));
  const [loud] = expoMessages(["ExponentPushToken[a]"], { title: "t", body: "b", data: { alertId: "1", event: "enquiry", href: "/admin" } }, false);
  const [quiet] = expoMessages(["ExponentPushToken[a]"], { title: "t", body: "b", data: { alertId: "1", event: "enquiry", href: "/admin" } }, true);
  assert.deepEqual([loud!.sound, loud!.channelId, quiet!.sound, quiet!.channelId], ["default", "alerts", null, "quiet"]);
});

test("Expo: batches of 100, and phones Expo no longer knows are dropped", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  const sent = expoMessages(["ExponentPushToken[a]", "ExponentPushToken[b]"], { title: "t", body: "b", data: { alertId: "", event: "x", href: "/" } }, false);
  assert.deepEqual(deadTokens(sent, { data: [{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }] }), ["ExponentPushToken[b]"]);
  assert.deepEqual(deadTokens(sent, { errors: [{}] }), []);
});

test("alert settings: today's emails stay on by default; quiet hours validated", () => {
  assert.equal(eventEnabled(undefined, "payment_submitted", "email"), true);
  assert.equal(eventEnabled(undefined, "ota_booking", "email"), false, "OTA bookings were never emailed");
  assert.equal(eventEnabled(undefined, "ota_booking", "push"), true);
  assert.equal(eventEnabled({ ota_booking: false }, "ota_booking", "push"), false);
  const view = settingsView({}, {});
  assert.equal(view.alerts.events.length, OWNER_EVENTS.length);
  assert.ok(view.alerts.events.every((e) => e.label && e.description));
  const ok = applySettingsPatch({}, { quietHours: { start: "22:00", end: "07:00" } }, {});
  assert.ok(ok.ok && ok.next.quietHours?.start === "22:00" && !ok.sensitive);
  assert.ok(!applySettingsPatch({}, { quietHours: { start: "25:00", end: "07:00" } }, {}).ok);
  const off = applySettingsPatch({ quietHours: { start: "22:00", end: "07:00" } }, { quietHours: null }, {});
  assert.ok(off.ok && off.next.quietHours === null);
});
