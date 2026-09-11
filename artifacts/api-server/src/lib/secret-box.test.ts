import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  SecretBoxError,
  encryptionAvailable,
  encryptionProblem,
  open,
  seal,
} from "./secret-box.ts";

/**
 * These run without a database or a mailbox. The point of them is that a
 * mistake here is not a bug that shows up as a wrong pixel — it is a mailbox
 * password sitting in the clear, or a password that can no longer be read
 * back after a deploy.
 */

const GOOD_KEY = randomBytes(32).toString("base64");

function withKey<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.MAIL_ENCRYPTION_KEY;
  if (value === undefined) delete process.env.MAIL_ENCRYPTION_KEY;
  else process.env.MAIL_ENCRYPTION_KEY = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.MAIL_ENCRYPTION_KEY;
    else process.env.MAIL_ENCRYPTION_KEY = previous;
  }
}

test("secret-box · a sealed password opens back to itself", () => {
  withKey(GOOD_KEY, () => {
    const password = "abcd efgh ijkl mnop"; // the shape Gmail issues
    assert.equal(open(seal(password)), password);
  });
});

test("secret-box · the ciphertext does not contain the password", () => {
  withKey(GOOD_KEY, () => {
    const sealed = seal("hunter2-correct-horse");
    assert.ok(!sealed.includes("hunter2"), "plaintext leaked into the sealed value");
    assert.match(sealed, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  });
});

test("secret-box · sealing twice gives different ciphertext", () => {
  withKey(GOOD_KEY, () => {
    // A fresh IV every time. Identical output would tell an observer which
    // two accounts share a password.
    assert.notEqual(seal("same password"), seal("same password"));
  });
});

test("secret-box · a tampered value refuses to open", () => {
  withKey(GOOD_KEY, () => {
    const sealed = seal("do not change me");
    const [version, iv, tag, body] = sealed.split(".");
    const flipped = body!.startsWith("A") ? `B${body!.slice(1)}` : `A${body!.slice(1)}`;

    assert.throws(
      () => open([version, iv, tag, flipped].join(".")),
      SecretBoxError,
      "a modified ciphertext opened anyway — the auth tag is not being checked",
    );
  });
});

test("secret-box · another key cannot open it", () => {
  const sealed = withKey(GOOD_KEY, () => seal("mailbox password"));
  withKey(randomBytes(32).toString("base64"), () => {
    assert.throws(() => open(sealed), SecretBoxError);
  });
});

test("secret-box · a missing or malformed key fails loudly, not silently", () => {
  withKey(undefined, () => {
    assert.equal(encryptionAvailable(), false);
    assert.throws(() => seal("x"), SecretBoxError);
  });
  withKey("too-short", () => {
    assert.equal(encryptionAvailable(), false);
    assert.throws(() => seal("x"), SecretBoxError);
  });
  withKey(GOOD_KEY, () => {
    assert.equal(encryptionAvailable(), true);
  });
});

test("secret-box · malformed sealed values are rejected by shape", () => {
  withKey(GOOD_KEY, () => {
    for (const bad of ["", "plain text", "v1.only.three", "v2.a.b.c"]) {
      assert.throws(() => open(bad), SecretBoxError, `accepted "${bad}"`);
    }
  });
});


/**
 * The diagnosis tests.
 *
 * On 11 September the server logged "MAIL_ENCRYPTION_KEY is not set" while
 * the variable was plainly there in Railway, and half an hour went into
 * looking for a missing variable instead of a bad value. These pin the
 * distinction: every unusable key has to say which kind of unusable it is,
 * and none of the messages may repeat the key back.
 */

test("secret-box · a good key reports no problem at all", () => {
  withKey(GOOD_KEY, () => {
    assert.equal(encryptionProblem(), null);
    assert.equal(encryptionAvailable(), true);
  });
});

test("secret-box · an absent key and a blank key both read as not set", () => {
  for (const value of [undefined, "", "   "]) {
    withKey(value, () => {
      assert.match(String(encryptionProblem()), /not set/i);
    });
  }
});

test("secret-box · a hex key is named as a hex key, not as 'not set'", () => {
  // The likeliest paste mistake: 64 hex characters decode, via base64, to
  // 48 bytes. Saying "48" without saying why sends you nowhere.
  withKey(randomBytes(32).toString("hex"), () => {
    const problem = String(encryptionProblem());
    assert.ok(!/not set/i.test(problem), "a present key was reported as absent");
    assert.match(problem, /48/);
    assert.match(problem, /hex/i);
  });
});

test("secret-box · a key with shell quoting left on it is called a paste error", () => {
  withKey(`"${GOOD_KEY}"`, () => {
    assert.match(String(encryptionProblem()), /not valid base64/i);
  });
});

test("secret-box · a short key reports its length", () => {
  withKey(randomBytes(16).toString("base64"), () => {
    assert.match(String(encryptionProblem()), /got 16/);
  });
});

test("secret-box · surrounding whitespace is forgiven, not fatal", () => {
  // Copying out of a terminal picks up a trailing newline; that should not
  // cost anyone an evening.
  withKey(`\n  ${GOOD_KEY}  \n`, () => {
    assert.equal(encryptionProblem(), null);
    assert.equal(open(seal("still works")), "still works");
  });
});

test("secret-box · no problem message ever contains the key", () => {
  for (const value of ["", randomBytes(32).toString("hex"), `"${GOOD_KEY}"`, randomBytes(16).toString("base64")]) {
    withKey(value, () => {
      const problem = String(encryptionProblem());
      const body = value.replace(/[^A-Za-z0-9+/=_-]/g, "");
      if (body.length > 8) {
        assert.ok(!problem.includes(body), "the key value leaked into the error");
      }
    });
  }
});
