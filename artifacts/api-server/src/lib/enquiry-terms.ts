import { pool } from "@workspace/db";

import { logger } from "./logger";
import { NO_TERMS, type EnquiryTerms } from "./enquiry-terms-rules";

/**
 * Storage for the owner's extra enquiry details (children's ages, a note,
 * the agreed price). A table of its own, created at boot and on first use
 * (additive, idempotent), so the enquiries table and every query on it are
 * untouched and no hand-run SQL is needed.
 */
export const ENQUIRY_TERMS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS enquiry_terms (
  enquiry_id uuid PRIMARY KEY REFERENCES enquiries(id) ON DELETE CASCADE,
  children_ages text,
  owner_note text,
  agreed_total_paise integer,
  agreed_advance_paise integer,
  price_note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

let migration: Promise<boolean> | null = null;

export function ensureEnquiryTermsTable(): Promise<boolean> {
  if (!migration) {
    migration = pool.query(ENQUIRY_TERMS_MIGRATION_SQL).then(
      () => true,
      (error: unknown) => {
        logger.error({ err: error }, "Could not create enquiry_terms");
        migration = null;
        return false;
      },
    );
  }
  return migration;
}

type Row = {
  enquiry_id: string;
  children_ages: string | null;
  owner_note: string | null;
  agreed_total_paise: number | null;
  agreed_advance_paise: number | null;
  price_note: string | null;
};

const toTerms = (row: Row): EnquiryTerms => ({
  childrenAges: row.children_ages,
  ownerNote: row.owner_note,
  agreedTotalPaise: row.agreed_total_paise,
  agreedAdvancePaise: row.agreed_advance_paise,
  priceNote: row.price_note,
});

/** Terms for many enquiries at once. A missing table reads as "no terms": the lists keep working. */
export async function termsFor(ids: string[]): Promise<Map<string, EnquiryTerms>> {
  const found = new Map<string, EnquiryTerms>();
  if (ids.length === 0 || !(await ensureEnquiryTermsTable())) return found;
  try {
    const { rows } = await pool.query<Row>(`SELECT * FROM enquiry_terms WHERE enquiry_id = ANY($1::uuid[])`, [ids]);
    for (const row of rows) found.set(row.enquiry_id, toTerms(row));
  } catch (error) {
    logger.error({ err: error }, "Could not read enquiry terms");
  }
  return found;
}

export async function termsOf(id: string): Promise<EnquiryTerms> {
  return (await termsFor([id])).get(id) ?? NO_TERMS;
}

/** Saves the merged terms for one enquiry. Throws when it cannot, so the caller can say so. */
export async function saveTerms(id: string, terms: EnquiryTerms): Promise<void> {
  if (!(await ensureEnquiryTermsTable())) throw new Error("Could not save the enquiry details just now. Please try again.");
  await pool.query(
    `INSERT INTO enquiry_terms (enquiry_id, children_ages, owner_note, agreed_total_paise, agreed_advance_paise, price_note, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (enquiry_id) DO UPDATE SET
       children_ages = EXCLUDED.children_ages,
       owner_note = EXCLUDED.owner_note,
       agreed_total_paise = EXCLUDED.agreed_total_paise,
       agreed_advance_paise = EXCLUDED.agreed_advance_paise,
       price_note = EXCLUDED.price_note,
       updated_at = now()`,
    [id, terms.childrenAges, terms.ownerNote, terms.agreedTotalPaise, terms.agreedAdvancePaise, terms.priceNote],
  );
}
