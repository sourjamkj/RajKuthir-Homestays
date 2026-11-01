import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The website books; it no longer takes enquiries.
 *
 * In November 2026 the owner removed "Send enquiry" and "Just send an
 * enquiry": the homepage form and the Book & Pay form on /rates finish one
 * way, "Hold dates & pay". What the site cannot book (six or more guests,
 * over thirty nights, online booking paused) goes to the host on WhatsApp
 * with the details already typed, and nothing is filed as an enquiry.
 *
 * These read the source rather than run it (the failure modes are textual:
 * a button or a fetch coming back), as the earlier version of this file did
 * when it pinned the opposite behaviour.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, "../../../..", "artifacts/raj-kuthir");
const APP_TSX = readFileSync(path.join(clientRoot, "src/App.tsx"), "utf8");
const BOOK_AND_PAY_TSX = readFileSync(path.join(clientRoot, "src/components/BookAndPay.tsx"), "utf8");
const ENQUIRY_ROUTES = readFileSync(path.join(here, "../routes/enquiries.ts"), "utf8");

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const APP_CODE = strip(APP_TSX);
const BOOK_AND_PAY_CODE = strip(BOOK_AND_PAY_TSX);

test("booking · no form on the site posts an enquiry any more", () => {
  for (const [name, code] of [["App.tsx", APP_CODE], ["BookAndPay.tsx", BOOK_AND_PAY_CODE]] as const) {
    assert.ok(!code.includes("'/api/enquiries'"), `${name} posts to /api/enquiries again`);
    assert.ok(!/Send enquiry|Just send an enquiry/.test(code), `${name} offers "Send enquiry" again`);
  }
});

test("booking · the homepage form's only submit holds the dates and pays", () => {
  const form = APP_CODE.slice(APP_CODE.indexOf("<form ref={formRef}"), APP_CODE.indexOf("</form>", APP_CODE.indexOf("<form ref={formRef}")));
  assert.ok(form.length > 0, "the booking form is gone");
  assert.match(form, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); if \(canPayOnline\) void startBooking\(\); \}\}/);
  assert.equal((form.match(/type="submit"/g) ?? []).length, 1, "there is more than one way to submit the form");
  assert.match(form, /data-testid="button-book-pay"/);
});

test("booking · what the site cannot book goes to WhatsApp, with the details typed", () => {
  assert.match(APP_CODE, /const bookByMessage = \(enquiryOnly && nights > 0\) \|\| bookingPaused;/);
  assert.match(APP_CODE, /<a href=\{bookByWhatsappUrl\}/);
  assert.match(APP_CODE, /data-testid="link-book-by-whatsapp"/);
  assert.match(BOOK_AND_PAY_CODE, /const bookByMessage = \(enquiryOnly && stayNights > 0\) \|\| bookingPaused;/);
  assert.match(BOOK_AND_PAY_CODE, /href=\{bookByWhatsappUrl\}/);
});

test("enquiry · no WhatsApp message is ever sent with placeholder answers in it", () => {
  for (const placeholder of ["To be shared", "To be confirmed"]) {
    assert.ok(!APP_CODE.includes(placeholder), `"${placeholder}" is back in the WhatsApp message`);
  }
});

test("enquiry · a blank form sends a plain hello, not a filled-in form", () => {
  const builder = APP_TSX.slice(APP_TSX.indexOf("const whatsappText = "), APP_TSX.indexOf("const whatsappUrl = "));
  assert.ok(builder.length > 0, "the WhatsApp message builder is gone");
  assert.match(builder, /if \(!hasEnquiryDetail\) return/, "an untouched form still composes a full message");
  for (const field of ["form.name.trim()", "form.phone.trim()"]) {
    assert.ok(builder.includes(field), `${field} is interpolated without being checked for content`);
  }
});

test("enquiry · the sticky phone bar is a plain wa.me link for questions", () => {
  assert.match(APP_CODE, /<a href=\{whatsappUrl\}[^>]*data-testid="button-sticky-whatsapp"/);
});

test("enquiry · the public enquiry endpoint refuses; the owner's hand entry stays", () => {
  assert.match(ENQUIRY_ROUTES, /const PUBLIC_ENQUIRIES_OPEN = false;/);
  const handler = ENQUIRY_ROUTES.slice(ENQUIRY_ROUTES.indexOf('router.post("/enquiries"'));
  assert.ok(handler.indexOf("if (!PUBLIC_ENQUIRIES_OPEN)") < handler.indexOf("tooMany("), "the refusal no longer comes first");
  assert.match(handler.slice(0, 600), /res\.status\(410\)/);
  assert.match(ENQUIRY_ROUTES, /router\.post\("\/admin\/enquiries", requireAdmin/, "the owner's hand-entry route is gone");
});
