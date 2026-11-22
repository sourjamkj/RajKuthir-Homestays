import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";

import { logger } from "./logger.ts";

/**
 * The house rules, added as the last page(s) of every booking confirmation
 * PDF, so a guest has them from the moment they book.
 *
 * shortcut: assets/house-rules.pdf is a copy of raj-kuthir/public/raj-kuthir-house-rules.pdf;
 * replace both when the rules change (a test checks they are identical).
 *
 * Same candidate paths as arrival-pack.ts: the process may start from the
 * repo root or the service directory, from src or from dist.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

export const HOUSE_RULES_CANDIDATES = [
  path.resolve(process.cwd(), "assets/house-rules.pdf"),
  path.resolve(process.cwd(), "artifacts/api-server/assets/house-rules.pdf"),
  path.resolve(here, "../../assets/house-rules.pdf"),
  path.resolve(here, "../../../assets/house-rules.pdf"),
];

export function findHouseRulesPdf(): string | null {
  return HOUSE_RULES_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

/** `pdf` with the house rules appended. Never throws: without the file, or on a bad PDF, the original comes back. */
export async function withHouseRules(pdf: Uint8Array, rulesFile = findHouseRulesPdf()): Promise<Uint8Array> {
  if (!rulesFile) return pdf;
  try {
    const doc = await PDFDocument.load(pdf);
    const rules = await PDFDocument.load(await readFile(rulesFile));
    for (const page of await doc.copyPages(rules, rules.getPageIndices())) doc.addPage(page);
    return await doc.save();
  } catch (error) {
    logger.warn({ err: error }, "Could not add the house rules to the PDF; sending it without them");
    return pdf;
  }
}
