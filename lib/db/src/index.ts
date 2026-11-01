import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// A connection resting in the pool can be closed by the database (a restart,
// maintenance, an idle timeout). pg reports that as an "error" event, and with
// no listener Node stops the whole server. Log it instead: the pool drops that
// connection and opens a new one for the next query.
pool.on("error", (error) => {
  console.error(`[db] idle connection closed: ${error.message}`);
});
export const db = drizzle(pool, { schema });

export * from "./schema";
