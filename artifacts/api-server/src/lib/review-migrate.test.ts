import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

test("reviews migration: the boot copy matches src/db/reviews.sql", () => {
  const sql = readFileSync(path.join(here, "../db/reviews.sql"), "utf8");
  const ts = readFileSync(path.join(here, "reviews-migrate.ts"), "utf8");
  const marker = "REVIEWS_MIGRATION_SQL = `";
  const start = ts.indexOf(marker) + marker.length;
  const end = ts.indexOf("`;", start);
  assert.equal(ts.slice(start, end), sql);
});

test("reviews migration: additive only", () => {
  const sql = readFileSync(path.join(here, "../db/reviews.sql"), "utf8");
  assert.doesNotMatch(sql, /\b(DROP|ALTER|DELETE|TRUNCATE|UPDATE)\b/i);
  for (const statement of sql.match(/CREATE (UNIQUE )?(TABLE|INDEX)[^\n]*/g) ?? []) {
    assert.match(statement, /IF NOT EXISTS/, statement);
  }
});

test("reviews migration: every column of the Drizzle schema is created", () => {
  const sql = readFileSync(path.join(here, "../db/reviews.sql"), "utf8");
  const schema = readFileSync(path.join(here, "../../../../lib/db/src/schema/reviews.ts"), "utf8");
  for (const [, column] of schema.matchAll(/\b(?:text|integer|uuid|timestamp)\("([a-z_]+)"/g)) {
    assert.match(sql, new RegExp(`\\n  ${column}\\s`), column);
  }
});
