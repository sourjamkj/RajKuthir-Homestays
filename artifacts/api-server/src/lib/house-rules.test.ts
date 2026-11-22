import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import { findHouseRulesPdf, withHouseRules } from "./house-rules.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

test("the server copy of the house rules matches the one on the website", () => {
  const server = readFileSync(path.resolve(here, "../../assets/house-rules.pdf"));
  const site = readFileSync(path.resolve(here, "../../../raj-kuthir/public/raj-kuthir-house-rules.pdf"));
  assert.ok(server.equals(site), "replace assets/house-rules.pdf with the new raj-kuthir-house-rules.pdf");
});

test("the house rules are appended after the confirmation pages", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const original = await doc.save();
  const rulesPages = (await PDFDocument.load(readFileSync(findHouseRulesPdf()!))).getPageCount();

  const merged = await PDFDocument.load(await withHouseRules(original));
  assert.equal(merged.getPageCount(), 1 + rulesPages);
});

test("without the rules file, or with a broken PDF, the original comes back untouched", async () => {
  const original = new Uint8Array([1, 2, 3]);
  assert.equal(await withHouseRules(original, null), original);
  assert.equal(await withHouseRules(original), original);
});
