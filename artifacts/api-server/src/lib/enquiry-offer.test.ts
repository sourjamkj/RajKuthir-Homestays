import assert from "node:assert/strict";
import test from "node:test";

import { buildEnquiryFollowUp } from "./enquiry-followup.ts";
import { looksLikeOfferToken, maskPhone, newOfferToken, offerProblem, offerUrl } from "./enquiry-offer-rules.ts";
import { quoteForEnquiry } from "./enquiry-quote.ts";
import { NO_TERMS, withAgreedPrice } from "./enquiry-terms-rules.ts";
import { buildEnquiryQuoteTemplate } from "./whatsapp-templates.ts";

const SITE = "https://rajkuthirhomestays.casa";
const stay = { checkIn: "2026-12-20", checkOut: "2026-12-23", adults: 7, children: 2, pets: 0 };
const agreed = { ...NO_TERMS, agreedTotalPaise: 2_100_000, agreedAdvancePaise: 1_050_000, priceNote: "20 and 21 Dec: ₹3,500 a night for 5" };

test("offer link · a random 24-character token in the URL fragment", () => {
  const token = newOfferToken();
  assert.ok(looksLikeOfferToken(token));
  assert.notEqual(token, newOfferToken());
  assert.equal(offerUrl(SITE, token), `${SITE}/offer#${token}`);
  assert.equal(looksLikeOfferToken("short"), false);
  assert.equal(looksLikeOfferToken("../../etc/passwd/xxxxxxxxxx"), false);
});

test("offer link · refused, in the guest's words, once booked, closed, undated or past", () => {
  const open = { status: "new", checkIn: "2026-12-20", checkOut: "2026-12-23", convertedBookingId: null };
  assert.equal(offerProblem(open, "2026-11-08"), null);
  assert.match(offerProblem({ ...open, status: "converted" }, "2026-11-08")!, /already booked/);
  assert.match(offerProblem({ ...open, status: "closed" }, "2026-11-08")!, /no longer open/);
  assert.match(offerProblem({ ...open, checkIn: null }, "2026-11-08")!, /no dates/);
  assert.match(offerProblem(open, "2026-12-21")!, /passed/);
});

test("offer link · the phone shows only enough to recognise it", () => {
  assert.equal(maskPhone("9933110299"), "99•••••299");
  assert.equal(maskPhone("+91 99331 10299"), "99•••••299");
});

test("offer link · the price reply ends with the ready-to-pay link instead of 'reply for payment details'", () => {
  const quote = withAgreedPrice(stay, quoteForEnquiry(stay, () => 425_000), agreed);
  const url = `${SITE}/offer#${"a".repeat(24)}`;
  const text = buildEnquiryFollowUp(
    { name: "Aritra Sinha", ...stay, status: "new", createdAt: "2026-11-03T17:15:00Z", quoteSentAt: null },
    { quote, datesTaken: null, returning: false, now: new Date("2026-11-03T17:30:00Z"), offerUrl: url },
  );
  assert.match(text, /• Total: ₹21,000/);
  assert.ok(text.includes(`already filled in. Check your name and pay the advance to confirm.\n${url}`), text);
  assert.doesNotMatch(text, /I will send the payment details/);

  const without = buildEnquiryFollowUp(
    { name: "Aritra Sinha", ...stay, status: "new", createdAt: "2026-11-03T17:15:00Z", quoteSentAt: null },
    { quote, datesTaken: null, returning: false, now: new Date("2026-11-03T17:30:00Z") },
  );
  assert.match(without, /I will send the payment details/);
});

test("offer link · the follow-up after a quote carries it too", () => {
  const quote = withAgreedPrice(stay, quoteForEnquiry(stay, () => 425_000), agreed);
  const url = `${SITE}/offer#${"b".repeat(24)}`;
  const text = buildEnquiryFollowUp(
    { name: "Aritra Sinha", ...stay, status: "contacted", createdAt: "2026-11-03T17:15:00Z", quoteSentAt: "2026-11-04T10:00:00Z" },
    { quote, datesTaken: null, returning: false, now: new Date("2026-11-05T10:00:00Z"), offerUrl: url },
  );
  assert.match(text, /following up on the quote/);
  assert.ok(text.includes(url));
});

test("offer link · the quote message offers it first, UPI as the fallback", () => {
  const quote = withAgreedPrice(stay, quoteForEnquiry(stay, () => 425_000), agreed);
  assert.ok(quote.ok);
  const url = `${SITE}/offer#${"c".repeat(24)}`;
  const spec = buildEnquiryQuoteTemplate({
    guestName: "Aritra Sinha",
    quote,
    upi: { id: "rk@ybl", name: "Raj Kuthir" },
    holdExpiresAt: new Date("2026-11-05T10:00:00Z"),
    offerUrl: url,
  });
  assert.ok(spec.preview.includes(`dates and amount already filled in):\n${url}\n\nOr pay by UPI: rk@ybl (Raj Kuthir)`), spec.preview);
  assert.equal(spec.params.length, 9);
});
