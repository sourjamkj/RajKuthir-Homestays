import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "@workspace/db";
import { pool } from "@workspace/db";

import { logger } from "./logger";
import {
  compareColumns,
  type ActualColumn,
  type SchemaProblem,
} from "./schema-check-rules";

/**
 * Tells the deploy log when the database and the Drizzle schema disagree.
 *
 * WHY THIS EXISTS
 *
 * The guest tables were hand-built from DDL that never matched
 * lib/db/src/schema/guests.ts, and production paid for it four times in one
 * day. Every failure was the same fault — schema drift — and each stayed
 * invisible until one particular operation ran:
 *
 *   guest_documents had no booking_id or deleted_at      500 on SELECT
 *   enquiries had no converted_booking_id                500 on SELECT
 *   guest_onboarding.guest_id was NOT NULL and unknown
 *     to the schema, so every INSERT omitted it          500 on INSERT
 *   booking_guests had no id column                      500 on a join
 *
 * A missing column announces itself the first time anything reads the table;
 * an extra required one stays quiet until something writes. Waiting for a
 * guest to trip over either is the expensive way to find out. This runs the
 * same comparison at boot, against every table in the schema.
 *
 * The rules themselves are in schema-check-rules.ts, which has no imports and
 * carries the tests. This file is the part that needs a database: it reads
 * information_schema, hands the rows to those rules, and logs the answer.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not check types, indexes, constraints or default values, and it
 * never repairs anything. The fix for a problem it reports is a migration in
 * src/db/, applied by hand — guest-tables.sql is the one for the guest tables.
 *
 * IT MUST NOT STOP THE SERVER
 *
 * A booking site does not refuse to boot over a schema warning, and it
 * especially does not refuse because this check itself broke. Every failure
 * path here ends in a log line. The one thing it may never do is throw.
 */

/** Every pgTable exported by lib/db/src/schema, whatever file it lives in. */
export function schemaTables(): PgTable[] {
  // @workspace/db exports the pool and the db handle alongside the tables, so
  // the values are widened to unknown before being narrowed by `is`. Without
  // that, the predicate is checked against a union it does not fit.
  const exported: unknown[] = Object.values(schema as Record<string, unknown>);

  return exported.filter((value): value is PgTable => is(value, PgTable));
}

/**
 * The database column names the code will actually ask for, read from the
 * Drizzle table object. Never a hand-written list: that would be a third copy
 * of the schema, and it would drift exactly as the DDL did.
 */
export function expectedColumnsOf(table: PgTable): string[] {
  return Object.values(getTableColumns(table)).map((column) => column.name);
}

type InformationSchemaRow = {
  table_name: string;
  column_name: string;
  is_nullable: string;
  column_default: string | null;
  is_identity: string;
};

/**
 * Reads every column of every public table in one query, rather than one round
 * trip per table. Startup is not the place for thirty queries.
 */
async function readLiveColumns(): Promise<Map<string, ActualColumn[]>> {
  const { rows } = await pool.query<InformationSchemaRow>(
    `SELECT table_name, column_name, is_nullable, column_default, is_identity
       FROM information_schema.columns
      WHERE table_schema = 'public'`,
  );

  const byTable = new Map<string, ActualColumn[]>();

  for (const row of rows) {
    const columns = byTable.get(row.table_name) ?? [];
    columns.push({
      name: row.column_name,
      notNull: row.is_nullable === "NO",
      // An identity column can be omitted from an insert just as a defaulted
      // one can, so it is never the kind of leftover this check hunts for.
      hasDefault: row.column_default !== null || row.is_identity === "YES",
    });
    byTable.set(row.table_name, columns);
  }

  return byTable;
}

export type SchemaCheckResult = {
  tables: number;
  missingTables: string[];
  problems: SchemaProblem[];
};

/**
 * Compares the schema against the live database and logs what it finds: one
 * error line per problem, or a single info line when everything matches.
 *
 * Resolves rather than rejects, always. Call it and forget it.
 */
export async function runSchemaCheck(): Promise<SchemaCheckResult> {
  const empty: SchemaCheckResult = { tables: 0, missingTables: [], problems: [] };

  try {
    const live = await readLiveColumns();
    const tables = schemaTables();
    const problems: SchemaProblem[] = [];
    const missingTables: string[] = [];

    for (const table of tables) {
      const name = getTableName(table);
      const actual = live.get(name);

      if (!actual) {
        // Listing every column of an absent table would bury the one fact
        // that matters: the table is not there at all.
        missingTables.push(name);
        continue;
      }

      problems.push(...compareColumns(expectedColumnsOf(table), actual, name));
    }

    for (const name of missingTables) {
      logger.error(
        { table: name },
        "Schema check: table is in the code but not in the database — every query against it will fail",
      );
    }

    for (const problem of problems) {
      if (problem.kind === "missing_column") {
        logger.error(
          { table: problem.table, column: problem.column },
          "Schema check: the code reads a column the database does not have — reads of this table will fail",
        );
      } else {
        logger.error(
          { table: problem.table, column: problem.column },
          "Schema check: the database requires a column the code never writes (NOT NULL, no default) — inserts into this table will fail",
        );
      }
    }

    if (problems.length === 0 && missingTables.length === 0) {
      logger.info(
        { tables: tables.length },
        "Schema check: the database matches the Drizzle schema",
      );
    } else {
      logger.error(
        { problems: problems.length, missingTables: missingTables.length },
        "Schema check: the database and the Drizzle schema disagree — see the lines above; fix with a migration in src/db/",
      );
    }

    return { tables: tables.length, missingTables, problems };
  } catch (error) {
    // Could not even look. Worth saying loudly; not worth a failed boot.
    logger.error(
      { err: error },
      "Schema check could not run — continuing without it",
    );
    return empty;
  }
}
