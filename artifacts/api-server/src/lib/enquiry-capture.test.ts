import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * That every enquiry the website takes actually reaches the server.
 *
 * WHY THIS FILE EXISTS
 *
 * The first real enquiry Raj Kuthir received through the site arrived on the
 * host's phone reading:
 *
 *   Name: To be shared
 *   Dates: To be confirmed to To be confirmed
 *   Guests: 2 adults, 0 children, 0 pets
 *   Phone: To be shared
 *
 * — and there was no matching row in the database, because the button that
 * sent it was a plain link to wa.me that never spoke to the API at all. Two
 * separate faults, both in the homepage, and neither visible from the server
 * side: an enquiry that never arrives leaves no log line to notice.
 *
 * These assertions read App.tsx rather than execute it, which is a weaker
 * kind of test, but the alternative is a browser and this failure mode is
 * textual: a literal placeholder string, and an anchor where a submit button
 * belongs.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, "../../../..", "artifacts/raj-kuthir");
const APP_TSX = readFileSync(path.join(clientRoot, "src/App.tsx"), "utf8");

/**
 * App.tsx with its comments removed.
 *
 * The comment above the message builder quotes the broken placeholders by
 * name, so a naive search for them finds the explanation of the bug and
 * reports the bug. Strip the prose, then look at the code.
 */
const APP_CODE = APP_TSX.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("enquiry · no message is ever sent with placeholder answers in it", () => {
  for (const placeholder of ["To be shared", "To be confirmed"]) {
    assert.ok(
      !APP_CODE.includes(placeholder),
      `"${placeholder}" is back in the WhatsApp message — an enquiry that cannot be answered`,
    );
  }
});

test("enquiry · a blank form sends a plain hello, not a filled-in form", () => {
  // The sticky mobile bar carries this message on every screen of the site,
  // so it is reachable long before the guest has typed anything.
  assert.match(
    APP_TSX,
    /const hasEnquiryDetail = /,
    "the message no longer distinguishes a filled form from an empty one",
  );
  const builder = APP_TSX.slice(
    APP_TSX.indexOf("const whatsappMessage = "),
    APP_TSX.indexOf("const whatsappUrl = "),
  );
  assert.ok(builder.length > 0, "the WhatsApp message builder is gone");
  assert.match(
    builder,
    /if \(!hasEnquiryDetail\) return/,
    "an untouched form still composes a full enquiry",
  );
  for (const field of ["form.name.trim()", "form.phone.trim()"]) {
    assert.ok(
      builder.includes(field),
      `${field} is interpolated without being checked for content`,
    );
  }
});

test("enquiry · the WhatsApp button records the enquiry before handing over", () => {
  // It used to be <a href={whatsappUrl}>, which is why the enquiry existed
  // only in WhatsApp and nowhere in the owner's console.
  const form = APP_TSX.slice(APP_TSX.indexOf("data-testid=\"form-booking-enquiry\""));
  const button = form.slice(form.indexOf("link-booking-whatsapp") - 600, form.indexOf("link-booking-whatsapp") + 200);

  assert.ok(
    !/<a[^>]*href=\{whatsappUrl\}[^>]*data-testid="link-booking-whatsapp"/.test(APP_TSX),
    "the in-form WhatsApp control is a bare link again, bypassing /api/enquiries",
  );
  assert.match(button, /type="submit"/, "the WhatsApp control does not submit the form");
  assert.match(
    button,
    /setHandOffToWhatsApp\(true\)/,
    "nothing marks the submission as one that should continue into WhatsApp",
  );
});

test("enquiry · WhatsApp opens only after the POST has been made", () => {
  const submit = APP_TSX.slice(
    APP_TSX.indexOf("const submitEnquiry = async"),
    APP_TSX.indexOf("const updateForm") > APP_TSX.indexOf("const submitEnquiry = async")
      ? APP_TSX.indexOf("const updateForm")
      : APP_TSX.indexOf("const submitEnquiry = async") + 4000,
  );

  const post = submit.indexOf("fetch('/api/enquiries'");
  const open = submit.indexOf("window.open(whatsappUrl");

  assert.ok(post > -1, "the enquiry is no longer POSTed");
  assert.ok(open > -1, "the WhatsApp hand-off is gone");
  assert.ok(post < open, "WhatsApp opens before the enquiry is recorded");
});

test("enquiry · a refused enquiry does not continue into WhatsApp", () => {
  // A 409 means the dates are taken. Sending the host a WhatsApp for a
  // booking the server just refused would tell the guest it went through.
  const submit = APP_TSX.slice(APP_TSX.indexOf("const submitEnquiry = async")).slice(0, 4000);
  const refusal = submit.indexOf("response.status === 409");
  const earlyReturn = submit.indexOf("return;", refusal);
  const open = submit.indexOf("window.open(whatsappUrl");

  assert.ok(refusal > -1 && earlyReturn > -1, "the refusal branch is gone");
  assert.ok(earlyReturn < open, "a refused enquiry still opens WhatsApp");
});

test("enquiry · the sticky mobile bar goes through the form, not straight to wa.me", () => {
  // The phone-only bar was the last bare wa.me link on the homepage: an
  // enquiry started there was never saved.
  assert.ok(
    !/<a[^>]*href=\{whatsappUrl\}[^>]*data-testid="button-sticky-whatsapp"/.test(APP_CODE),
    "the sticky WhatsApp bar is a bare link again, bypassing /api/enquiries",
  );
  assert.match(APP_CODE, /onClick=\{enquireFromStickyBar\}[^>]*data-testid="button-sticky-whatsapp"/);

  const handler = APP_CODE.slice(
    APP_CODE.indexOf("const enquireFromStickyBar"),
    APP_CODE.indexOf("const shiftCalendarMonth"),
  );
  assert.match(handler, /checkValidity\(\)/, "a filled form is not detected");
  assert.match(handler, /link-booking-whatsapp"\]'\)\?\.click\(\)/, "a filled form is not saved before WhatsApp");
  assert.match(handler, /scrollToAvailability\(\)/, "an empty form does not lead to the form");
  assert.match(APP_CODE, /<form id="enquiry-form"/, "the form the bar looks for has lost its id");
});
