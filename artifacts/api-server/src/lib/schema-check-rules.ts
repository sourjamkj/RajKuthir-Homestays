/**
 * What counts as schema drift, and what does not. No imports, on purpose.
 *
 * WHY THIS IS A FILE OF ITS OWN
 *
 * schema-check.ts has to import @workspace/db to read the Drizzle table
 * objects, and that module opens a connection pool the moment it is loaded —
 * so nothing that imports it can be unit-tested under `node --test`. The rules
 * are the part worth testing, so they live here, where a test can reach them
 * without a database. Same reason guest-verification-rules.ts sits apart from
 * guest-onboarding-repo.ts.
 *
 * THE TWO SHAPES OF DRIFT
 *
 * Production hit four 500s in one day from the database and the schema
 * disagreeing, and they came in two kinds, each fatal to a different verb:
 *
 *   MISSING COLUMN         the code selects a column the table does not have,
 *                          so every read of that table fails. This was
 *                          guest_documents.booking_id, guest_documents
 *                          .deleted_at, enquiries.converted_booking_id and
 *                          booking_guests.id.
 *   EXTRA REQUIRED COLUMN  the table demands a NOT NULL column with no default
 *                          that the code knows nothing about, so every insert
 *                          omits it and is rejected. This was
 *                          guest_onboarding.guest_id.
 *
 * An extra column that is nullable, or that has a default, is NOT drift worth
 * reporting: an insert that ignores it still succeeds, and a leftover column
 * nothing reads costs nothing. Reporting it would only teach the reader to
 * skip these lines.
 */

/** A column as information_schema describes it. */
export type ActualColumn = {
  name: string;
  /** NOT NULL in the database. */
  notNull: boolean;
  /** Has a DEFAULT, or is an identity column — either way an insert may omit it. */
  hasDefault: boolean;
};

export type SchemaProblem =
  | { kind: "missing_column"; table: string; column: string }
  | { kind: "unexpected_required_column"; table: string; column: string };

/**
 * Compares the columns the code expects against the columns the database has.
 * Pure: no database, no logger, no clock.
 */
export function compareColumns(
  expected: readonly string[],
  actual: readonly ActualColumn[],
  table = "",
): SchemaProblem[] {
  const problems: SchemaProblem[] = [];
  const present = new Set(actual.map((column) => column.name));
  const wanted = new Set(expected);

  // Breaks every SELECT of this table.
  for (const column of expected) {
    if (!present.has(column)) {
      problems.push({ kind: "missing_column", table, column });
    }
  }

  // Breaks every INSERT into this table.
  for (const column of actual) {
    if (wanted.has(column.name)) continue;
    if (!column.notNull || column.hasDefault) continue;
    problems.push({
      kind: "unexpected_required_column",
      table,
      column: column.name,
    });
  }

  return problems;
}
