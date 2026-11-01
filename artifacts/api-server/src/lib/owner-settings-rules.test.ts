import assert from "node:assert/strict";
import test from "node:test";

import {
  OWNER_EVENTS,
  applySettingsPatch,
  normaliseIndianMobile,
  parseStoredSettings,
  railwayStatus,
  resolveAlertEmail,
  resolveAutoreply,
  resolveCaretakerWhatsapp,
  resolveOwnerWhatsapp,
  resolveWhatsappMode,
  settingsView,
  whatsappReadiness,
} from "./owner-settings-rules.ts";

const API_ON = {
  WHATSAPP_ENABLED: "true",
  WHATSAPP_PHONE_NUMBER_ID: "123",
  WHATSAPP_ACCESS_TOKEN: "secret-token",
};

test("nothing saved: every value is what the server used before (Railway, then default)", () => {
  assert.deepEqual(resolveAlertEmail({}, {}), { value: null, source: "default" });
  assert.deepEqual(resolveAlertEmail({}, { OWNER_ALERT_EMAIL: "a@b.in" }), { value: "a@b.in", source: "railway" });
  assert.deepEqual(resolveOwnerWhatsapp({}, {}), { value: "+91 62903 99165", source: "default" });
  assert.deepEqual(resolveCaretakerWhatsapp({}, { CARETAKER_WHATSAPP: "+91 70000 00000" }), { value: "+91 70000 00000", source: "railway" });
  assert.deepEqual(resolveAutoreply({}, {}), { value: false, source: "default" });
  assert.deepEqual(resolveAutoreply({}, { WHATSAPP_AUTOREPLY_ENABLED: "true" }), { value: true, source: "railway" });
});

test("a saved value wins over Railway", () => {
  const stored = { alertEmail: "me@x.in", ownerWhatsapp: "+91 98300 12345", whatsappAutoreply: false };
  assert.equal(resolveAlertEmail(stored, { OWNER_ALERT_EMAIL: "old@x.in" }).value, "me@x.in");
  assert.equal(resolveOwnerWhatsapp(stored, { OWNER_WHATSAPP_NUMBER: "+91 70000 00000" }).source, "console");
  assert.deepEqual(resolveAutoreply(stored, { WHATSAPP_AUTOREPLY_ENABLED: "true" }), { value: false, source: "console" });
});

test("WhatsApp mode: unset keeps today's behaviour, so deploying never starts or stops a message", () => {
  assert.deepEqual(resolveWhatsappMode({}, {}), { value: "manual", source: "default" });
  assert.deepEqual(resolveWhatsappMode({}, API_ON), { value: "api", source: "default" });
  assert.deepEqual(resolveWhatsappMode({ whatsappMode: "manual" }, API_ON), { value: "manual", source: "console" });
});

test("Business API readiness lists exactly what is missing; the template is a warning, not a blocker", () => {
  const none = whatsappReadiness({});
  assert.equal(none.ready, false);
  assert.equal(none.missing.length, 3);
  const on = whatsappReadiness(API_ON);
  assert.equal(on.ready, true);
  assert.equal(on.warnings.length, 1);
  assert.equal(whatsappReadiness({ ...API_ON, WHATSAPP_CONFIRMATION_TEMPLATE: "booking_confirmed" }).warnings.length, 0);
  assert.equal(whatsappReadiness({ ...API_ON, WHATSAPP_ENABLED: "yes" }).ready, false, "the same 'true' the client checks");
});

test("switching to the Business API is refused until it is ready", () => {
  const refused = applySettingsPatch({}, { whatsappMode: "api" }, {});
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.status, 409);
  const ok = applySettingsPatch({}, { whatsappMode: "api" }, API_ON);
  assert.ok(ok.ok && ok.next.whatsappMode === "api" && ok.sensitive);
  const back = applySettingsPatch({ whatsappMode: "api" }, { whatsappMode: "manual" }, {});
  assert.ok(back.ok && back.next.whatsappMode === "manual", "manual is always allowed");
});

test("emails and Indian mobiles are validated and normalised", () => {
  assert.equal(normaliseIndianMobile("9830012345"), "+91 98300 12345");
  assert.equal(normaliseIndianMobile("+91-98300-12345"), "+91 98300 12345");
  assert.equal(normaliseIndianMobile("09830012345"), "+91 98300 12345");
  assert.equal(normaliseIndianMobile("5830012345"), null);
  assert.equal(normaliseIndianMobile("12345"), null);

  const good = applySettingsPatch({}, { alertEmail: " Owner@Example.IN ", caretakerWhatsapp: "78726 85558" }, {});
  assert.ok(good.ok);
  assert.equal(good.ok && good.next.alertEmail, "owner@example.in");
  assert.equal(good.ok && good.next.caretakerWhatsapp, "+91 78726 85558");
  assert.deepEqual(good.ok && good.changed.sort(), ["alertEmail", "caretakerWhatsapp"]);

  for (const body of [{ alertEmail: "not-an-email" }, { ownerWhatsapp: "12345" }, { whatsappAutoreply: "yes" }, { whatsappMode: "auto" }]) {
    const r = applySettingsPatch({}, body, {});
    assert.ok(!r.ok && r.status === 400, JSON.stringify(body));
  }
});

test("null or empty clears a field back to Railway; unknown fields are refused", () => {
  const cleared = applySettingsPatch({ alertEmail: "me@x.in" }, { alertEmail: "" }, {});
  assert.ok(cleared.ok && cleared.next.alertEmail === null && cleared.sensitive);
  const unknown = applySettingsPatch({}, { upiId: "thief@ybl" }, {});
  assert.ok(!unknown.ok && /Unknown setting: upiId/.test(unknown.error), "the UPI ID can never be changed from the console");
  assert.ok(!applySettingsPatch({}, [], {}).ok);
});

test("only contacts and WhatsApp mode need a fresh confirmation; switches and alerts do not", () => {
  const plain = applySettingsPatch({}, { whatsappAutoreply: true, pushEvents: { enquiry: false } }, {});
  assert.ok(plain.ok && !plain.sensitive);
  assert.deepEqual(plain.ok && plain.next.pushEvents, { enquiry: false });
  const merged = applySettingsPatch({ pushEvents: { enquiry: false } }, { pushEvents: { ota_booking: false } }, {});
  assert.deepEqual(merged.ok && merged.next.pushEvents, { enquiry: false, ota_booking: false });
  assert.ok(!applySettingsPatch({}, { pushEvents: { nope: true } }, {}).ok);
  const sameValue = applySettingsPatch({ whatsappAutoreply: true }, { whatsappAutoreply: true }, {});
  assert.ok(sameValue.ok && sameValue.changed.length === 0, "saving the same value changes nothing");
  assert.ok(applySettingsPatch({}, { confirmPassword: "x", whatsappAutoreply: true }, {}).ok, "the password is not a setting");
});

test("a damaged or old stored document never breaks the server", () => {
  assert.deepEqual(parseStoredSettings(null), {});
  assert.deepEqual(parseStoredSettings("{oops"), {});
  assert.deepEqual(parseStoredSettings('"text"'), {});
  const parsed = parseStoredSettings(JSON.stringify({ alertEmail: "bad", ownerWhatsapp: "9830012345", whatsappMode: "x", pushEvents: { enquiry: false, nope: true } }));
  assert.deepEqual(parsed, { ownerWhatsapp: "+91 98300 12345", pushEvents: { enquiry: false } });
});

test("Settings shows whether each Railway secret is set, and never its value", () => {
  const env = { ...API_ON, RAJ_KUTHIR_UPI_ID: "9674138627-2@ybl", RAJ_KUTHIR_SESSION_SECRET: "very-secret" };
  const rows = railwayStatus(env);
  const token = rows.find((r) => r.name === "WHATSAPP_ACCESS_TOKEN")!;
  assert.deepEqual([token.set, token.value], [true, null]);
  assert.equal(rows.find((r) => r.name === "RAJ_KUTHIR_UPI_ID")!.value, "9674138627-2@ybl");
  assert.equal(rows.find((r) => r.name === "BLUETICKS_API_KEY")!.set, false);
  const view = JSON.stringify(settingsView({}, env));
  assert.ok(!view.includes("secret-token") && !view.includes("very-secret"));
  assert.equal(Object.keys(settingsView({}, {}).alerts.push).length, OWNER_EVENTS.length);
});
