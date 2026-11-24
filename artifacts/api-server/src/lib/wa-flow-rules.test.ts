import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedPhoneNumberIdMatches,
  parseWaFlowAnswers,
} from "./wa-flow-rules.ts";

const valid = {
  flow_token: "meta-token",
  check_in: "2027-01-10",
  check_out: "2027-01-12",
  adults: "2",
  children: "1",
  bringing_pets: "true",
  pet_count: "1",
};
test("WhatsApp Flow accepts valid responses and coerces supported scalar strings", () => {
  assert.deepEqual(parseWaFlowAnswers(JSON.stringify(valid), "2026-11-24"), {
    check_in: "2027-01-10",
    check_out: "2027-01-12",
    adults: 2,
    children: 1,
    bringing_pets: true,
    pet_count: 1,
  });
});
test("WhatsApp Flow rejects malformed, incomplete, past and inconsistent answers", () => {
  for (const raw of [
    "{",
    {},
    { ...valid, adults: undefined },
    { ...valid, check_in: "2026-11-23" },
    { ...valid, check_out: "2027-01-09" },
    { ...valid, adults: "0" },
    { ...valid, children: "4" },
    { ...valid, pet_count: "0" },
    { ...valid, pet_count: "5" },
    { ...valid, bringing_pets: "false" },
    { ...valid, extra: "x" },
  ]) {
    assert.equal(
      parseWaFlowAnswers(raw, "2026-11-24"),
      null,
      JSON.stringify(raw),
    );
  }
  assert.equal(
    parseWaFlowAnswers(
      { ...valid, bringing_pets: "false", pet_count: "0" },
      "2026-11-24",
    )?.pet_count,
    0,
  );
  assert.equal(
    parseWaFlowAnswers(
      { ...valid, bringing_pets: "false", pet_count: undefined },
      "2026-11-24",
    )?.pet_count,
    0,
  );
});
test("WhatsApp webhook identifier must match the configured business phone id", () => {
  assert.equal(expectedPhoneNumberIdMatches("123", "123"), true);
  assert.equal(expectedPhoneNumberIdMatches("other", "123"), false);
  assert.equal(expectedPhoneNumberIdMatches("123", undefined), false);
});
