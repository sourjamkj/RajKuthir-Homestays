import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COMMON_REJECTION_REASONS,
  UPLOAD_INSTRUCTIONS,
  rejectionReasonProblem,
} from "./document-rejection-rules.ts";

test("a rejection needs a reason the guest can act on", () => {
  assert.ok(rejectionReasonProblem(""));
  assert.ok(rejectionReasonProblem("   "));
  assert.ok(rejectionReasonProblem(null));
  assert.ok(rejectionReasonProblem("bad"));
  assert.ok(rejectionReasonProblem("x".repeat(301)));
  assert.equal(rejectionReasonProblem("The photo is blurred"), null);
  for (const reason of COMMON_REJECTION_REASONS) assert.equal(rejectionReasonProblem(reason), null);
});

test("upload instructions cover who, what, quality and file limits", () => {
  const all = UPLOAD_INSTRUCTIONS.join(" ");
  for (const word of ["every guest", "Aadhaar", "passport", "back", "corners", "expired", "visa", "PDF"]) {
    assert.ok(all.includes(word), `instructions miss "${word}"`);
  }
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("mandate: the reject route refuses a rejection without a reason", () => {
  const route = read("../routes/guest-onboarding.ts");
  assert.match(route, /rejectionReasonProblem\(/);
});

test("mandate: console and app send the reason with upload instructions, and require it", () => {
  for (const path of ["../../../raj-kuthir/src/pages/AdminGuests.tsx", "../../../owner-app/src/guestMessages.ts"]) {
    const extra = path.includes("raj-kuthir") ? read("../../../raj-kuthir/src/lib/id-upload.ts") : "";
    const file = read(path) + extra;
    assert.match(file, /buildDocumentsRejectedMessage/, `${path} has no rejection message`);
    assert.match(file, /Reason:/, `${path} does not state the reason`);
    assert.match(file, /all four corners/, `${path} lacks upload instructions`);
  }
  assert.doesNotMatch(read("../../../raj-kuthir/src/pages/AdminGuests.tsx"), /rejected\? \(optional\)/);
  assert.doesNotMatch(read("../../../owner-app/src/screens/guests/StaysSection.tsx"), /rejected\? \(optional\)/);
});

test("mandate: the pre-arrival page shows the rejection reason and the checklist", () => {
  const page = read("../../../raj-kuthir/src/pages/PreArrival.tsx");
  assert.match(page, /lookup\.rejection/);
  assert.match(page, /UPLOAD_INSTRUCTIONS/);
});
