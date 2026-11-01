import assert from "node:assert/strict";
import test from "node:test";

import {
  PROPERTY_LINE,
  caretakerWhatsappLink,
  istToday,
  prettyMonth,
  renderCaretakerMessage,
  validateCaretakerMessage,
} from "./caretaker-messages-rules.ts";

const people = { caretakerName: "Rina", ownerSignature: "Sourja Mukherjee" };

test("salary credited: professional, bold facts, signed, and never an amount", () => {
  const v = validateCaretakerMessage({ kind: "salary_credited", fields: { month: "2026-10", date: "2026-11-01", method: "UPI" } });
  assert.ok(v.ok);
  const text = renderCaretakerMessage(v.kind, v.fields, people, "2026-11-01");
  assert.equal(
    text,
    [
      PROPERTY_LINE,
      "",
      "Dear Rina,",
      "",
      "This is to let you know that your salary for *October 2026* has been credited today, 1 Nov 2026, by UPI.",
      "",
      "Please check, and let me know if anything does not look right.",
      "",
      "Thank you for looking after the house so well.",
      "",
      "Warm regards,",
      "Sourja Mukherjee",
      "Raj Kuthir Homestays – Sobuj Potro",
    ].join("\n"),
  );
  assert.doesNotMatch(text, /₹|Rs\.?\s*\d|\d{3,}\s*(rupees|INR)/i);
});

test("'today' is said only when it is true; otherwise the date", () => {
  const v = validateCaretakerMessage({ kind: "salary_credited", fields: { month: "2026-10", date: "2026-10-31", method: "bank transfer" } });
  assert.ok(v.ok);
  assert.match(renderCaretakerMessage(v.kind, v.fields, people, "2026-11-01"), /credited on 31 Oct 2026, by bank transfer\./);
});

test("no name set: a polite 'Hello,'", () => {
  const v = validateCaretakerMessage({ kind: "day_off", fields: { from: "2026-11-10", to: "2026-11-10" } });
  assert.ok(v.ok);
  const text = renderCaretakerMessage(v.kind, v.fields, { caretakerName: null, ownerSignature: "Sourja Mukherjee" }, "2026-11-01");
  assert.match(text, /^\*Raj Kuthir Homestays – Sobuj Potro\*\n\nHello,\n/);
  assert.match(text, /Your leave on \*10 Nov 2026\* is approved\./);
});

test("a notice keeps its paragraphs and turns '-' lines into • bullets; typed formatting marks are removed", () => {
  const v = validateCaretakerMessage({
    kind: "notice",
    fields: { subject: "Guests *tomorrow*", message: "Please get the house ready:\n- fresh linen\n- fill the water filter\n\n\n\nThank you" },
  });
  assert.ok(v.ok);
  const text = renderCaretakerMessage(v.kind, v.fields, people, "2026-11-01");
  assert.match(text, /\*Guests tomorrow\*\n\nPlease get the house ready:\n• fresh linen\n• fill the water filter\n\nThank you/);
});

test("bad input is refused with a reason a person can act on", () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ kind: "loan" }, /Choose what the message is about/],
    [{ kind: "salary_credited", fields: { date: "2026-11-01", method: "UPI" } }, /Salary for is needed/],
    [{ kind: "salary_credited", fields: { month: "2026-13", date: "2026-11-01", method: "UPI" } }, /choose a month/],
    [{ kind: "salary_credited", fields: { month: "2026-10", date: "2026-11-01", method: "cheque" } }, /one of the options/],
    [{ kind: "day_off", fields: { from: "2026-11-12", to: "2026-11-10" } }, /before the first/],
    [{ kind: "notice", fields: { subject: "x", message: "y".repeat(1001) } }, /too long/],
  ];
  for (const [body, error] of cases) {
    const v = validateCaretakerMessage(body);
    assert.ok(!v.ok && error.test(v.error), JSON.stringify(body));
  }
});

test("the WhatsApp link goes to the caretaker's number with the text encoded", () => {
  const link = caretakerWhatsappLink("+91 78726 85558", "Hello,\nRina");
  assert.equal(link, "https://wa.me/917872685558?text=Hello%2C%0ARina");
  assert.equal(caretakerWhatsappLink("12345", "x"), null);
});

test("dates read the Indian way", () => {
  assert.equal(prettyMonth("2026-10"), "October 2026");
  assert.equal(istToday(new Date("2026-10-31T19:00:00Z")), "2026-11-01", "after 18:30 UTC it is already tomorrow in India");
});
