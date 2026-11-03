import assert from "node:assert/strict";
import test from "node:test";

import { buildEnquiryFollowUp } from "./enquiry-followup.ts";
import { quoteForEnquiry } from "./enquiry-quote.ts";
import { datesProblem, NO_TERMS, parseEnquiryEdit, termsProblem, withAgreedPrice } from "./enquiry-terms-rules.ts";

const mobile = (raw: string) => {
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  return digits.length === 10 ? digits : digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : null;
};

// The real enquiry that showed the gap: Aritra Sinha, 20–23 Dec 2026, 7 adults
// and 2 children, agreed ₹3,500 a night for five + ₹750 per extra guest, ₹5,000
// on 22 Dec: ₹21,000 with ₹10,500 to confirm.
const aritra = { checkIn: "2026-12-20", checkOut: "2026-12-23", adults: 7, children: 2, pets: 0 };
const agreed = {
  ...NO_TERMS,
  childrenAges: "6 and 9",
  agreedTotalPaise: 2_100_000,
  agreedAdvancePaise: 1_050_000,
  priceNote: "₹3,500 a night for 5 (₹5,000 on 22 Dec, Poush Mela week) + ₹750 a night for each extra guest, with bedding",
};

test("enquiry edit · reads party, ages, note and the agreed price in rupees", () => {
  const edit = parseEnquiryEdit(
    { adults: "7", children: 2, pets: "", childrenAges: " 6 and 9 ", ownerNote: "Called at 10:42 pm", agreedTotalRupees: "₹21,000", agreedAdvanceRupees: 10500 },
    mobile,
  );
  assert.ok(edit.ok);
  assert.deepEqual(edit.fields, { adults: 7, children: 2, pets: null });
  assert.deepEqual(edit.terms, { childrenAges: "6 and 9", ownerNote: "Called at 10:42 pm", agreedTotalPaise: 2_100_000, agreedAdvancePaise: 1_050_000 });
});

test("enquiry edit · only the keys sent change; bad values are refused in plain words", () => {
  const only = parseEnquiryEdit({ ownerNote: "x" }, mobile);
  assert.ok(only.ok);
  assert.deepEqual(only.fields, {});
  assert.deepEqual(only.terms, { ownerNote: "x" });
  assert.deepEqual(parseEnquiryEdit({ name: " " }, mobile), { ok: false, error: "The guest's name cannot be empty." });
  assert.equal(parseEnquiryEdit({ phone: "12" }, mobile).ok, false);
  assert.equal(parseEnquiryEdit({ checkIn: "20/12/2026" }, mobile).ok, false);
  assert.equal(parseEnquiryEdit({ adults: -1 }, mobile).ok, false);
  assert.equal(parseEnquiryEdit({ agreedTotalRupees: "abc" }, mobile).ok, false);
  const cleared = parseEnquiryEdit({ agreedTotalRupees: "" }, mobile);
  assert.ok(cleared.ok && cleared.terms.agreedTotalPaise === null);
});

test("enquiry edit · dates in order and the advance inside the total", () => {
  assert.equal(datesProblem("2026-12-23", "2026-12-20"), "Check-out must be after check-in.");
  assert.equal(datesProblem("2026-12-20", null), null);
  assert.equal(termsProblem({ ...NO_TERMS, agreedAdvancePaise: 100 }), "Set the agreed total before the advance.");
  assert.equal(termsProblem({ ...NO_TERMS, agreedTotalPaise: 100, agreedAdvancePaise: 200 }), "The advance cannot be more than the agreed total.");
  assert.equal(termsProblem(agreed), null);
});

test("agreed price · replaces the rate card and keeps the owner's advance", () => {
  const rateCard = quoteForEnquiry(aritra, () => 425_000);
  const quote = withAgreedPrice(aritra, rateCard, agreed);
  assert.ok(quote.ok);
  assert.equal(quote.nights, 3);
  assert.equal(quote.guests, 9);
  assert.equal(quote.totalPaise, 2_100_000);
  assert.equal(quote.advancePaise, 1_050_000);
  assert.equal(quote.balancePaise, 1_050_000);
  assert.equal(quote.agreed, true);
});

test("agreed price · without an advance, the usual share; peak stays paid in full", () => {
  const rateCard = { ...quoteForEnquiry(aritra, () => 425_000), advancePercent: 100, peak: "Poush Mela, Christmas & New Year" } as never;
  const quote = withAgreedPrice(aritra, rateCard, { ...agreed, agreedAdvancePaise: null });
  assert.ok(quote.ok);
  assert.equal(quote.advancePaise, 2_100_000);
  assert.equal(quote.peak, "Poush Mela, Christmas & New Year");
});

test("agreed price · needs dates and a party; no agreed price leaves the rate card alone", () => {
  const rateCard = quoteForEnquiry(aritra, () => 425_000);
  assert.equal(withAgreedPrice(aritra, rateCard, NO_TERMS), rateCard);
  assert.deepEqual(withAgreedPrice({ ...aritra, checkIn: null }, rateCard, agreed), { ok: false, reason: "Add the dates to use the agreed price." });
  assert.deepEqual(withAgreedPrice({ ...aritra, adults: null, children: null }, rateCard, agreed), {
    ok: false,
    reason: "Add the number of guests to use the agreed price.",
  });
});

test("agreed price · the WhatsApp reply gives the owner's price, breakdown and advance", () => {
  const quote = withAgreedPrice(aritra, quoteForEnquiry(aritra, () => 425_000), agreed);
  const text = buildEnquiryFollowUp(
    { name: "Aritra Sinha", ...aritra, status: "new", createdAt: "2026-11-03T17:15:00Z", quoteSentAt: null },
    { quote, datesTaken: null, returning: false, now: new Date("2026-11-03T17:30:00Z") },
  );
  assert.match(text, /• Check-in: Sun, 20 Dec, from 12 noon/);
  assert.match(text, /• Check-out: Wed, 23 Dec, by 11 am/);
  assert.match(text, /• Stay: 3 nights for 9 guests\n/);
  assert.match(text, /• ₹3,500 a night for 5 \(₹5,000 on 22 Dec, Poush Mela week\)/);
  assert.match(text, /• Total: ₹21,000/);
  assert.match(text, /• Advance to confirm: ₹10,500, the balance at check-in/);
  assert.doesNotMatch(text, /how many of you/i);
});

test("agreed price · a breakdown typed on several lines becomes one bullet per line", () => {
  const note = "20 and 21 Dec: ₹3,500 a night for 5 guests\n• 22 Dec: ₹5,000 for 5 guests, as it is the first night of the Poush Mela week\n\n- 4 more guests with extra bedding: ₹750 each a night";
  const quote = withAgreedPrice(aritra, quoteForEnquiry(aritra, () => 425_000), { ...agreed, priceNote: note });
  const text = buildEnquiryFollowUp(
    { name: "Aritra Sinha", ...aritra, status: "new", createdAt: "2026-11-03T17:15:00Z", quoteSentAt: null },
    { quote, datesTaken: null, returning: false, now: new Date("2026-11-03T17:30:00Z") },
  );
  assert.ok(
    text.includes(
      "• Stay: 3 nights for 9 guests\n" +
        "• 20 and 21 Dec: ₹3,500 a night for 5 guests\n" +
        "• 22 Dec: ₹5,000 for 5 guests, as it is the first night of the Poush Mela week\n" +
        "• 4 more guests with extra bedding: ₹750 each a night\n" +
        "• Total: ₹21,000\n" +
        "• Advance to confirm: ₹10,500, the balance at check-in",
    ),
    text,
  );
});
