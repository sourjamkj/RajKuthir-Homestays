import { pool } from "@workspace/db";

import { logger } from "./logger";
import { looksLikeOfferToken, newOfferToken } from "./enquiry-offer-rules";

/**
 * One ready-to-pay link per enquiry. The token is kept as it is (not
 * hashed) because the same link must appear every time the reply is
 * written; it unlocks nothing but that enquiry's offer page. A table of its
 * own, created at boot and on first use (additive, idempotent).
 */
export const ENQUIRY_OFFERS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS enquiry_offers (
  enquiry_id uuid PRIMARY KEY REFERENCES enquiries(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

let migration: Promise<boolean> | null = null;

export function ensureEnquiryOffersTable(): Promise<boolean> {
  if (!migration) {
    migration = pool.query(ENQUIRY_OFFERS_MIGRATION_SQL).then(
      () => true,
      (error: unknown) => {
        logger.error({ err: error }, "Could not create enquiry_offers");
        migration = null;
        return false;
      },
    );
  }
  return migration;
}

/** The link token for each enquiry, made on first use. Never throws: a reply without a link still goes out. */
export async function offerTokensFor(ids: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (ids.length === 0) return found;
  try {
    if (!(await ensureEnquiryOffersTable())) return found;
    const fresh = ids.map(() => newOfferToken());
    await pool.query(
      `INSERT INTO enquiry_offers (enquiry_id, token)
       SELECT * FROM unnest($1::uuid[], $2::text[])
       ON CONFLICT (enquiry_id) DO NOTHING`,
      [ids, fresh],
    );
    const { rows } = await pool.query<{ enquiry_id: string; token: string }>(
      `SELECT enquiry_id, token FROM enquiry_offers WHERE enquiry_id = ANY($1::uuid[])`,
      [ids],
    );
    for (const row of rows) found.set(row.enquiry_id, row.token);
  } catch (error) {
    logger.error({ err: error }, "Could not read enquiry offer links");
  }
  return found;
}

export async function offerTokenFor(id: string): Promise<string | null> {
  return (await offerTokensFor([id])).get(id) ?? null;
}

/** The enquiry a link belongs to, or null. */
export async function enquiryIdForOffer(token: string): Promise<string | null> {
  if (!looksLikeOfferToken(token) || !(await ensureEnquiryOffersTable())) return null;
  const { rows } = await pool.query<{ enquiry_id: string }>(`SELECT enquiry_id FROM enquiry_offers WHERE token = $1`, [token]);
  return rows[0]?.enquiry_id ?? null;
}
