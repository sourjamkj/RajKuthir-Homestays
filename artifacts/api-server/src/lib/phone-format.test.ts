import { test } from "node:test";
import assert from "node:assert/strict";
import { whatsappReadyPhone } from "./phone-format.ts";

test("a bare Indian mobile gains +91", () => {
  assert.equal(whatsappReadyPhone("98765 43210"), "+919876543210");
});

test("+91, 91 and a leading 0 all land on the same number", () => {
  assert.equal(whatsappReadyPhone("+91 98765-43210"), "+919876543210");
  assert.equal(whatsappReadyPhone("919876543210"), "+919876543210");
  assert.equal(whatsappReadyPhone("09876543210"), "+919876543210");
});

test("a foreign number keeps its own country code", () => {
  assert.equal(whatsappReadyPhone("+44 7700 900123"), "+447700900123");
});

test("too short or too long is refused rather than guessed", () => {
  assert.equal(whatsappReadyPhone("12345"), null);
  assert.equal(whatsappReadyPhone("1234567890123456"), null);
  assert.equal(whatsappReadyPhone(""), null);
});
