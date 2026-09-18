import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  compareColumns,
  type ActualColumn,
} from "./schema-check-rules.ts";

/**
 * The comparison is pure, so these need no database — which is why it was
 * split out of schema-check.ts, whose @workspace/db import opens a connection
 * pool at module load. Each case below is one of the four failures production
 * actually had.
 *
 * Run with:  node --test src/lib/
 */

const here = path.dirname(fileURLToPath(import.meta.url));

const column = (
  name: string,
  overrides: Partial<ActualColumn> = {},
): ActualColumn => ({ name, notNull: false, hasDefault: false, ...overrides });

/** A primary key: NOT NULL with a default, and never a problem. */
const id = () => column("id", { notNull: true, hasDefault: true });

test("schema check · a clean table reports nothing", () => {
  const problems = compareColumns(
    ["id", "booking_id", "status"],
    [
      id(),
      column("booking_id", { notNull: true }),
      column("status", { notNull: true, hasDefault: true }),
    ],
    "guest_onboarding",
  );

  assert.deepEqual(problems, []);
});

test("schema check · a column the code expects and the database lacks is reported", () => {
  // guest_documents had no booking_id or deleted_at, so every SELECT of it
  // answered 500 with ERROR 42703 (undefined_column).
  const problems = compareColumns(
    ["id", "guest_id", "booking_id", "deleted_at"],
    [id(), column("guest_id", { notNull: true })],
    "guest_documents",
  );

  assert.deepEqual(problems, [
    { kind: "missing_column", table: "guest_documents", column: "booking_id" },
    { kind: "missing_column", table: "guest_documents", column: "deleted_at" },
  ]);
});

test("schema check · an extra NOT NULL column with no default is reported", () => {
  // guest_onboarding.guest_id: NOT NULL, absent from the schema, so every
  // INSERT omitted it and every INSERT was rejected with 23502.
  const problems = compareColumns(
    ["id", "booking_id"],
    [
      id(),
      column("booking_id", { notNull: true }),
      column("guest_id", { notNull: true }),
    ],
    "guest_onboarding",
  );

  assert.deepEqual(problems, [
    {
      kind: "unexpected_required_column",
      table: "guest_onboarding",
      column: "guest_id",
    },
  ]);
});

test("schema check · an extra column that is nullable is ignored", () => {
  // A leftover column nothing reads costs nothing: inserts that omit it still
  // succeed. Reporting it would teach the reader to skip these lines.
  const problems = compareColumns(
    ["id"],
    [id(), column("revoked_at"), column("legacy_note")],
    "guest_onboarding",
  );

  assert.deepEqual(problems, []);
});

test("schema check · an extra NOT NULL column with a default is ignored", () => {
  // guest_onboarding.updated_at is exactly this: NOT NULL, unknown to the
  // schema, and harmless, because the default fills it in.
  const problems = compareColumns(
    ["id"],
    [id(), column("updated_at", { notNull: true, hasDefault: true })],
    "guest_onboarding",
  );

  assert.deepEqual(problems, []);
});

test("schema check · both kinds of drift are reported together", () => {
  const problems = compareColumns(
    ["id", "converted_booking_id"],
    [id(), column("guest_id", { notNull: true })],
    "enquiries",
  );

  assert.deepEqual(problems, [
    {
      kind: "missing_column",
      table: "enquiries",
      column: "converted_booking_id",
    },
    {
      kind: "unexpected_required_column",
      table: "enquiries",
      column: "guest_id",
    },
  ]);
});

test("schema check · a table the database does not have at all reports every column", () => {
  // booking_guests lost its id column; an absent table is the same fault taken
  // to its limit. schema-check.ts collapses this case to one line per table,
  // but the rules still describe it honestly.
  const problems = compareColumns(["id", "booking_id"], [], "booking_guests");

  assert.deepEqual(problems.map((p) => p.column), ["id", "booking_id"]);
  assert.ok(problems.every((p) => p.kind === "missing_column"));
});

test("schema check · the table name is carried through for the log line", () => {
  const [problem] = compareColumns(["id"], [], "booking_guests");

  assert.equal(problem!.table, "booking_guests");
  assert.equal(problem!.column, "id");
});

test("schema check · order is stable: missing columns before extra ones", () => {
  // The log is read top to bottom. Reads break before writes do, so they are
  // reported first.
  const problems = compareColumns(
    ["a", "b"],
    [column("c", { notNull: true })],
    "t",
  );

  assert.deepEqual(problems.map((p) => p.kind), [
    "missing_column",
    "missing_column",
    "unexpected_required_column",
  ]);
});

// -------------------------------------------------- what it checks against

test("schema check · the expected columns come from Drizzle, not a written list", () => {
  // The value of this check is that it cannot drift. If the table list is ever
  // typed out by hand it becomes a third copy of the schema and joins in the
  // drift it exists to catch.
  const source = readFileSync(path.join(here, "schema-check.ts"), "utf8");

  assert.match(source, /getTableColumns/, "expected columns are no longer read from the table objects");
  assert.match(source, /is\(value, PgTable\)/, "tables are no longer discovered from the schema exports");
  assert.ok(
    !/"(guests|bookings|guest_documents)"/.test(source),
    "a table name is hard-coded in schema-check.ts — it should discover them",
  );
});

test("schema check · every schema file's tables are reachable through the module it reads", () => {
  // schema-check.ts imports * from @workspace/db, which re-exports every file
  // in lib/db/src/schema. This asserts that barrel still exports them all, so
  // "every table in the schema" stays true as files are added.
  const schemaDir = path.join(here, "../../../../lib/db/src/schema");
  const barrel = readFileSync(path.join(schemaDir, "index.ts"), "utf8");

  const files = readdirSync(schemaDir).filter(
    (file) => file.endsWith(".ts") && file !== "index.ts",
  );

  assert.ok(files.length >= 9, `only ${files.length} schema files found`);
  for (const file of files) {
    const name = file.replace(/\.ts$/, "");
    assert.match(
      barrel,
      new RegExp(`export \\* from "\\./${name}"`),
      `lib/db/src/schema/index.ts does not re-export ${file}, so its tables are unchecked`,
    );
  }
});
