import { pool } from "@workspace/db";

import { logger } from "./logger";

/**
 * Creates the Cashfree tables at boot, after the Book & Pay tables they
 * reference. Additive and idempotent, like book-pay-migrate.ts: a failure is
 * a log line and online payment simply stays off.
 *
 * The text is a copy of src/db/cashfree.sql; cashfree-rules.test.ts fails if
 * the two ever differ.
 */
export const CASHFREE_MIGRATION_SQL = `-- Online payments for Book & Pay through Cashfree.
--
-- Two NEW tables. Nothing existing is altered. Safe to run more than once;
-- the server also applies it at boot (lib/cashfree-migrate.ts).

CREATE TABLE IF NOT EXISTS gateway_orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  provider           text NOT NULL DEFAULT 'cashfree',
  order_id           text NOT NULL,
  cf_order_id        text,
  amount_paise       integer NOT NULL,
  status             text NOT NULL DEFAULT 'ACTIVE',
  expires_at         timestamptz NOT NULL,
  cf_payment_id      text,
  payment_group      text,
  bank_reference     text,
  paid_at            timestamptz,
  settled_at         timestamptz,
  settle_note        text,
  raw                jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gateway_order_order_id_uniq ON gateway_orders (order_id);
CREATE INDEX        IF NOT EXISTS gateway_order_request_idx   ON gateway_orders (payment_request_id);
CREATE INDEX        IF NOT EXISTS gateway_order_status_idx    ON gateway_orders (status);

CREATE TABLE IF NOT EXISTS gateway_refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_order_id   uuid NOT NULL REFERENCES gateway_orders(id) ON DELETE CASCADE,
  refund_id          text NOT NULL,
  cf_refund_id       text,
  amount_paise       integer NOT NULL,
  status             text NOT NULL DEFAULT 'PENDING',
  note               text,
  raw                jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gateway_refund_refund_id_uniq ON gateway_refunds (refund_id);
CREATE INDEX        IF NOT EXISTS gateway_refund_order_idx      ON gateway_refunds (gateway_order_id);
`;

export async function ensureCashfreeTables(): Promise<void> {
  try {
    await pool.query(CASHFREE_MIGRATION_SQL);
    logger.info("Cashfree tables are in place");
  } catch (error) {
    logger.error({ err: error }, "Could not apply the Cashfree migration; online payment stays off");
  }
}
