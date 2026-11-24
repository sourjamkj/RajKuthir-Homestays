import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, "wa-flow-enquiry.ts"), "utf8");
const repo = readFileSync(path.join(here, "enquiries-repo.ts"), "utf8");
const webhook = readFileSync(
  path.join(here, "../routes/wa-webhook.ts"),
  "utf8",
);
const mcp = readFileSync(path.join(here, "mcp-guest.ts"), "utf8");

test("Flow enquiry uses the existing enquiry, availability and quote paths only", () => {
  assert.match(source, /createWhatsappEnquiry\(/);
  assert.match(source, /priceCheck\(/);
  assert.match(source, /event: "enquiry"/);
  assert.doesNotMatch(
    source,
    /createBooking|startHold|blockDates|INSERT INTO bookings/,
  );
  assert.match(
    repo,
    /onConflictDoNothing\(\{ target: enquiries\.whatsappSubmissionId \}\)/,
  );
});

test("guest confirmation is exact, after durable insert, and duplicate submissions do not resend", () => {
  assert.match(
    source,
    /Thank you! 🌿 Your enquiry has been received\. We're checking your dates and preparing your quotation\. We'll contact you on WhatsApp shortly\./,
  );
  assert.ok(
    source.indexOf("createWhatsappEnquiry(") <
      source.indexOf("if (result.created)") &&
      source.indexOf("if (result.created)") < source.indexOf("sendText("),
  );
});

test("webhook rejects invalid signatures and returns a retryable failure if durable acceptance fails", () => {
  assert.match(
    webhook,
    /if \(!verifySignature\(rawBody, signature\)\)[\s\S]*?res\.sendStatus\(401\)/,
  );
  assert.match(webhook, /catch \(error\)[\s\S]*?res\.sendStatus\(503\)/);
  assert.match(webhook, /await storeInbound\(msg\)/);
});

test("Hermes enquiry tool takes a Meta message id, never a caller-supplied phone", () => {
  assert.match(mcp, /"create_guest_enquiry"/);
  assert.match(mcp, /inputSchema: \{[\s\S]*?messageId: z\.string/);
  assert.match(
    mcp,
    /SELECT phone, payload FROM wa_inbound_messages WHERE wa_id = \$1/,
  );
  assert.doesNotMatch(mcp, /inputSchema: \{[^}]*phone:/s);
});
