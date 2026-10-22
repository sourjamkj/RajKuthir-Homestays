import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySignature, parseWebhookPayload, isWithin24h, shouldAutoReply } from "./wa-webhook-rules.ts";

/* ------------------------------------------------------------------ *
 * verifySignature
 * ------------------------------------------------------------------ */

describe("verifySignature", () => {
  const SECRET = "test_app_secret_abc123";

  function sign(body: Buffer, secret = SECRET): string {
    const hmac = createHmac("sha256", secret).update(body).digest("hex");
    return `sha256=${hmac}`;
  }

  // The real env var is checked inside the function; we need to set it
  // temporarily for these tests.
  const origSecret = process.env["WHATSAPP_APP_SECRET"];
  const setSecret = (v: string | undefined) => {
    if (v === undefined) delete process.env["WHATSAPP_APP_SECRET"];
    else process.env["WHATSAPP_APP_SECRET"] = v;
  };

  it("accepts a valid signature", () => {
    setSecret(SECRET);
    try {
      const body = Buffer.from('{"entry":[]}');
      assert.equal(verifySignature(body, sign(body)), true);
    } finally {
      setSecret(origSecret);
    }
  });

  it("rejects a tampered body", () => {
    setSecret(SECRET);
    try {
      const body = Buffer.from('{"entry":[]}');
      const sig = sign(body);
      const tampered = Buffer.from('{"entry":[{"malicious":true}]}');
      assert.equal(verifySignature(tampered, sig), false);
    } finally {
      setSecret(origSecret);
    }
  });

  it("rejects a missing signature header", () => {
    setSecret(SECRET);
    try {
      const body = Buffer.from('{"entry":[]}');
      assert.equal(verifySignature(body, undefined), false);
    } finally {
      setSecret(origSecret);
    }
  });

  it("rejects when APP_SECRET is not set", () => {
    setSecret(undefined);
    try {
      const body = Buffer.from('{"entry":[]}');
      assert.equal(verifySignature(body, sign(body, "doesnt_matter")), false);
    } finally {
      setSecret(origSecret);
    }
  });

  it("rejects a wrong algorithm prefix", () => {
    setSecret(SECRET);
    try {
      const body = Buffer.from('{"entry":[]}');
      const hmac = createHmac("sha256", SECRET).update(body).digest("hex");
      assert.equal(verifySignature(body, `sha1=${hmac}`), false);
    } finally {
      setSecret(origSecret);
    }
  });
});

/* ------------------------------------------------------------------ *
 * parseWebhookPayload
 * ------------------------------------------------------------------ */

describe("parseWebhookPayload", () => {
  it("parses a text message", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                messages: [
                  {
                    id: "wamid.abc123",
                    from: "919876543210",
                    timestamp: "1700000000",
                    type: "text",
                    text: { body: "Hello" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const result = parseWebhookPayload(payload);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0]!.waId, "wamid.abc123");
    assert.equal(result.messages[0]!.phone, "919876543210");
    assert.equal(result.messages[0]!.type, "text");
    assert.equal(result.messages[0]!.text, "Hello");
  });

  it("parses interactive button reply", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                messages: [
                  {
                    id: "wamid.btn456",
                    from: "919876543210",
                    timestamp: "1700000001",
                    type: "interactive",
                    interactive: {
                      type: "button_reply",
                      button_reply: { id: "CHECK_DATES", title: "Check dates & price" },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const result = parseWebhookPayload(payload);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0]!.type, "interactive");
    assert.equal(result.messages[0]!.text, "CHECK_DATES");
  });

  it("parses status callbacks", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                statuses: [
                  { id: "wamid.sent1", status: "delivered", timestamp: "1700000002" },
                  { id: "wamid.sent2", status: "failed", timestamp: "1700000003", errors: [{ code: 131047, title: "Re-engagement message" }] },
                ],
              },
            },
          ],
        },
      ],
    };

    const result = parseWebhookPayload(payload);
    assert.equal(result.statuses.length, 2);
    assert.equal(result.statuses[0]!.status, "delivered");
    assert.equal(result.statuses[1]!.status, "failed");
    assert.equal(result.statuses[1]!.errorCode, "131047");
    assert.equal(result.statuses[1]!.errorTitle, "Re-engagement message");
  });

  it("ignores entries without messaging_product whatsapp", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messaging_product: "messenger",
                messages: [{ id: "msg1", from: "123", timestamp: "1700000000", type: "text", text: { body: "hi" } }],
              },
            },
          ],
        },
      ],
    };
    const result = parseWebhookPayload(payload);
    assert.equal(result.messages.length, 0);
  });

  it("handles an empty payload", () => {
    const result = parseWebhookPayload({});
    assert.equal(result.messages.length, 0);
    assert.equal(result.statuses.length, 0);
  });

  it("normalises phone numbers via toWhatsappNumber", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                messages: [
                  { id: "wamid.x", from: "6290399165", timestamp: "1700000000", type: "text", text: { body: "hi" } },
                ],
              },
            },
          ],
        },
      ],
    };
    const result = parseWebhookPayload(payload);
    assert.equal(result.messages[0]!.phone, "916290399165");
  });
});

/* ------------------------------------------------------------------ *
 * isWithin24h
 * ------------------------------------------------------------------ */

describe("isWithin24h", () => {
  it("returns true for a message 1h ago", () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3_600_000);
    assert.equal(isWithin24h(oneHourAgo, now), true);
  });

  it("returns false for a message 25h ago", () => {
    const now = new Date();
    const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 3_600_000);
    assert.equal(isWithin24h(twentyFiveHoursAgo, now), false);
  });

  it("returns false for null", () => {
    assert.equal(isWithin24h(null), false);
  });
});

/* ------------------------------------------------------------------ *
 * shouldAutoReply
 * ------------------------------------------------------------------ */

describe("shouldAutoReply", () => {
  const origEnabled = process.env["WHATSAPP_AUTOREPLY_ENABLED"];
  const origNumbers = process.env["WHATSAPP_TEST_NUMBERS"];

  it("returns true when autoreply is enabled globally", () => {
    process.env["WHATSAPP_AUTOREPLY_ENABLED"] = "true";
    try {
      assert.equal(shouldAutoReply("919999999999"), true);
    } finally {
      if (origEnabled === undefined) delete process.env["WHATSAPP_AUTOREPLY_ENABLED"];
      else process.env["WHATSAPP_AUTOREPLY_ENABLED"] = origEnabled;
    }
  });

  it("returns true for a test number even when autoreply is off", () => {
    delete process.env["WHATSAPP_AUTOREPLY_ENABLED"];
    process.env["WHATSAPP_TEST_NUMBERS"] = "919876543210,916290399165";
    try {
      assert.equal(shouldAutoReply("919876543210"), true);
      assert.equal(shouldAutoReply("919999999999"), false);
    } finally {
      if (origEnabled === undefined) delete process.env["WHATSAPP_AUTOREPLY_ENABLED"];
      else process.env["WHATSAPP_AUTOREPLY_ENABLED"] = origEnabled;
      if (origNumbers === undefined) delete process.env["WHATSAPP_TEST_NUMBERS"];
      else process.env["WHATSAPP_TEST_NUMBERS"] = origNumbers;
    }
  });

  it("returns false when autoreply is off and no test numbers", () => {
    delete process.env["WHATSAPP_AUTOREPLY_ENABLED"];
    delete process.env["WHATSAPP_TEST_NUMBERS"];
    try {
      assert.equal(shouldAutoReply("919876543210"), false);
    } finally {
      if (origEnabled !== undefined) process.env["WHATSAPP_AUTOREPLY_ENABLED"] = origEnabled;
      if (origNumbers !== undefined) process.env["WHATSAPP_TEST_NUMBERS"] = origNumbers;
    }
  });
});
