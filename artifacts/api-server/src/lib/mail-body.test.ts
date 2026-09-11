import assert from "node:assert/strict";
import test from "node:test";

import { bodyText, htmlToText } from "./mail-body.ts";
import { parseGoMmtVoucher } from "./mail-parsers/gomt.ts";

/**
 * The join between a received email and a parser.
 *
 * This is the part of the pipeline most likely to rot quietly: a channel
 * switches to HTML-only mail, the conversion mangles it, and bookings simply
 * stop arriving with nothing in the logs to say why. The last test here is
 * the one that matters — it takes an HTML voucher of the shape these emails
 * actually have and proves the real parser still reads every field out of it.
 */

test("body · a text/plain part is preferred and left alone", () => {
  const text = "CHECK-IN | 02 Oct '26\nBooking ID GH75081277131254";
  assert.equal(bodyText({ text, html: "<p>something else entirely</p>" }), text);
});

test("body · table cells become separators, rows become lines", () => {
  const html = "<table><tr><td>CHECK-IN</td><td>CHECK-OUT</td></tr><tr><td>02 Oct</td><td>04 Oct</td></tr></table>";

  const out = htmlToText(html);

  // Without the cell separator these four values would run together and a
  // parser would read "CHECK-INCHECK-OUT".
  assert.match(out, /CHECK-IN \| CHECK-OUT/);
  assert.match(out, /02 Oct \| 04 Oct/);
  assert.equal(out.split("\n").length, 2);
});

test("body · scripts, styles and comments do not become text", () => {
  const html = `
    <style>.x{color:red}</style>
    <script>var tracking = 1;</script>
    <!-- a comment -->
    <p>Booking Status</p><p>Confirmed</p>
  `;

  const out = htmlToText(html);

  assert.ok(!out.includes("color:red"), "stylesheet text leaked into the body");
  assert.ok(!out.includes("tracking"), "script text leaked into the body");
  assert.ok(!out.includes("a comment"));
  assert.match(out, /Booking Status\nConfirmed/);
});

test("body · entities that matter to a parser are decoded", () => {
  // The rupee sign and the non-breaking space both appear in these vouchers,
  // and a parser looking for "₹ 4,266.0" will not match "&#8377;".
  assert.match(htmlToText("<p>Total&nbsp;&#8377;&nbsp;4,266.0</p>"), /₹ 4,266\.0/);
  assert.equal(htmlToText("<p>Tea &amp; toast</p>"), "Tea & toast");
});

test("body · an email with no readable part yields nothing, not noise", () => {
  assert.equal(bodyText({ text: "", html: false }), "");
  assert.equal(bodyText({}), "");
});

test("body · an HTML voucher still parses into a complete booking", () => {
  // The same booking as the booking-oct fixture, in the HTML shape these
  // emails arrive in rather than the flattened text we captured.
  const html = `
    <html><body>
      <table>
        <tr><td>Host Voucher</td></tr>
        <tr><td>Raj Kuthir Homestays - Sobuj Potro, Shantiniketan</td></tr>
        <tr><td>PRIMARY GUEST DETAILS</td></tr>
        <tr><td>Sudipta Saha</td></tr>
        <tr><td>CHECK-IN</td><td>CHECK-OUT</td></tr>
        <tr><td>02 Oct '26 12:00 PM</td><td>04 Oct '26 (2 Nights) 11:00 AM</td></tr>
        <tr><td>TOTAL NO. OF GUEST(S)</td></tr>
        <tr><td>3 Adults</td></tr>
        <tr><td>Booking ID</td></tr>
        <tr><td>GH75081277131254</td></tr>
        <tr><td>Booking Status</td></tr>
        <tr><td>Confirmed</td></tr>
      </table>
    </body></html>
  `;

  const parsed = parseGoMmtVoucher(
    "New Booking Received - GH75081277131254",
    "no-reply@goibibo.com",
    bodyText({ html }),
  );

  assert.ok(parsed, "an HTML voucher produced nothing at all");
  assert.equal(parsed.externalRef, "GH75081277131254");
  assert.equal(parsed.status, "confirmed");
  assert.equal(parsed.guestName, "Sudipta Saha");
  assert.equal(parsed.checkIn, "2026-10-02");
  assert.equal(parsed.checkOut, "2026-10-04");
  assert.equal(parsed.guests, 3);
});
