import { pool } from "@workspace/db";

import { listAllEvents } from "./calendar-repo";
import { DATES_AVAILABLE_TEMPLATE, freedDatesPlan, type WaitlistRow } from "./dates-freed-rules";
import { listEnquiries } from "./enquiries-repo";
import { sendEnquiryQuote } from "./enquiry-actions";
import { todayInIndia } from "./guest-lookup";
import { logger } from "./logger";
import { notifyOwner } from "./owner-alerts";
import { autoSendKinds } from "./owner-settings-state";
import { guestApiSendingOn } from "./whatsapp-mode";

/**
 * Runs after every calendar sync (every 15 minutes): remembers open enquiries
 * whose dates are taken, and sends rk_dates_available to the first one whose
 * dates come free. Off until "Dates free again" is ticked in Settings →
 * WhatsApp auto-send. Never throws.
 *
 * Its own table (additive, idempotent), so nothing on enquiries is altered.
 */
export const DATES_FREED_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS enquiry_dates_waitlist (
  enquiry_id uuid PRIMARY KEY REFERENCES enquiries(id) ON DELETE CASCADE,
  taken_seen_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz
);
`;

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
const istHour = (at: Date) => new Date(at.getTime() + IST_OFFSET_MS).getUTCHours();

export async function notifyFreedDates(now = new Date()): Promise<number> {
  try {
    await pool.query(DATES_FREED_MIGRATION_SQL);
    const [enquiries, taken, { rows }] = await Promise.all([
      listEnquiries(),
      listAllEvents(),
      pool.query<{ enquiry_id: string; notified_at: Date | null }>("SELECT enquiry_id, notified_at FROM enquiry_dates_waitlist"),
    ]);
    const waitlist = new Map<string, WaitlistRow>(rows.map((r) => [r.enquiry_id, { notifiedAt: r.notified_at }]));
    const plan = freedDatesPlan({ enquiries, taken, waitlist, today: todayInIndia(now), now });

    // Remembered whatever the switch says, so turning it on later still finds them.
    if (plan.markTaken.length) {
      await pool.query(
        "INSERT INTO enquiry_dates_waitlist (enquiry_id) SELECT unnest($1::uuid[]) ON CONFLICT (enquiry_id) DO NOTHING",
        [plan.markTaken],
      );
    }

    if (!guestApiSendingOn() || !autoSendKinds().includes("dates_available")) return 0;
    const hour = istHour(now);
    if (hour < 8 || hour >= 23) return 0;

    let sent = 0;
    for (const id of plan.notify) {
      const result = await sendEnquiryQuote(id, { templateName: DATES_AVAILABLE_TEMPLATE });
      if (!result.ok) {
        logger.warn({ enquiryId: id, error: result.body["error"] }, "Could not send the dates-free-again message");
        continue;
      }
      await pool.query("UPDATE enquiry_dates_waitlist SET notified_at = $2 WHERE enquiry_id = $1", [id, now]);
      sent += 1;
      const e = result.body.enquiry;
      await notifyOwner(
        {
          event: "enquiry",
          title: "Dates free again: guest told",
          body: `${e?.name ?? "A guest"} was told ${e?.checkIn} to ${e?.checkOut} are free, with the price and a Book button. Held 24 hours.`,
          href: `/admin/guests#enquiry-${id}`,
          dedupeKey: `dates-free-${id}`,
        },
        now,
      );
    }
    return sent;
  } catch (error) {
    logger.error({ err: error }, "The dates-free-again check failed");
    return 0;
  }
}
