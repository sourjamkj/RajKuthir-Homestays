import { pool } from "@workspace/db";

import { auditCalendar } from "./calendar-repo";

import { logger } from "./logger";
import { notifyOwner } from "./owner-alerts";
import {
  JOBS,
  alertFor,
  blockWithoutBookingCheck,
  databaseCheck,
  doubleBookingCheck,
  jobCheck,
  outboxCheck,
  paidNotBookedCheck,
  publicStatus,
  step,
  withMissingAsOk,
  type CheckResult,
  type CheckState,
  type JobBeat,
  type JobId,
} from "./ops-rules";
import { guestApiSendingOn } from "./whatsapp-mode";

/**
 * Ops watch (level L0: observe and tell, never act). Every five minutes it
 * checks the database, the background jobs and the WhatsApp outbox, and turns
 * a confirmed problem into one owner alert (app list, push, email), one
 * "recovered" when it clears, and a daily reminder while a P0/P1 stays open.
 *
 * GET /api/health/ops exposes only the overall status (503 only for a P0), so an outside monitor
 * (GitHub Actions, .github/workflows/uptime.yml) still raises the alarm when
 * this whole server, or its database, is down and cannot alert anyone itself.
 */

// shortcut: state lives in memory, so a restart forgets open incidents and a still-broken check re-alerts once after a deploy; move to a table if that gets noisy.
const beats = new Map<JobId, JobBeat>();
let states: Record<string, CheckState> = {};
const labels: Record<string, string> = {};
let lastResults: CheckResult[] = [];

/** A job calls this when it starts its timer. Jobs that never start are not watched. */
export function jobStarted(id: JobId, now = Date.now()): void {
  if (!beats.has(id)) beats.set(id, { startedAt: now, lastOk: null, lastError: null, failsInRow: 0 });
}

export function jobOk(id: JobId, now = Date.now()): void {
  const beat = beats.get(id);
  if (beat) Object.assign(beat, { lastOk: now, failsInRow: 0, lastError: null });
}

export function jobFailed(id: JobId, error: unknown): void {
  const beat = beats.get(id);
  if (!beat) return;
  beat.failsInRow += 1;
  beat.lastError = error instanceof Error ? error.message : String(error);
}

async function runChecks(now: Date): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  let dbOk = true;
  try {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("no answer in 5 s")), 5_000);
    });
    await Promise.race([pool.query("SELECT 1"), timeout]).finally(() => clearTimeout(timer));
    results.push(databaseCheck(true));
  } catch (error) {
    dbOk = false;
    results.push(databaseCheck(false, error instanceof Error ? error.message : String(error)));
  }

  for (const [id, beat] of beats) results.push(jobCheck(id, beat, now.getTime()));

  // Only when the API actually sends (in manual mode pending rows wait for the owner by
  // design), and not 23:00-09:00 IST, when guest DND holds messages back on purpose.
  const istHour = new Date(now.getTime() + 330 * 60_000).getUTCHours();
  if (dbOk && guestApiSendingOn() && istHour >= 9 && istHour < 23) {
    try {
      // Same holds as claimDueMessages: arrival messages and the confirmation PDF wait for a verified ID.
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM whatsapp_messages m
         WHERE m.status = 'pending' AND m.send_after < now() - interval '45 minutes'
           AND NOT (m.kind IN ('checkin_reminder', 'checkin_welcome') AND EXISTS (
             SELECT 1 FROM guest_onboarding o WHERE o.booking_id = m.booking_id AND o.status <> 'verified'))
           AND (m.kind <> 'booking_confirmed' OR EXISTS (
             SELECT 1 FROM guest_onboarding o WHERE o.booking_id = m.booking_id AND o.status = 'verified'))`,
      );
      results.push(outboxCheck(Number(rows[0]?.n ?? 0)));
    } catch (error) {
      logger.warn({ err: error }, "Ops watch could not read the outbox");
    }
  }
  if (dbOk) results.push(...(await integrityChecks()));
  return results;
}

/** A failed query must not read as "recovered": an open incident keeps its last result until the query works again. */
const stillOpen = (id: string): CheckResult[] => (states[id]?.failing ? lastResults.filter((r) => r.id === id) : []);

/** Read-only. */
async function integrityChecks(): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  try {
    const { rows } = await pool.query<{ a_in: string; a_out: string; b_in: string; b_out: string }>(
      `SELECT a.check_in::text AS a_in, a.check_out::text AS a_out, b.check_in::text AS b_in, b.check_out::text AS b_out
       FROM bookings a JOIN bookings b ON a.id < b.id AND a.check_in < b.check_out AND b.check_in < a.check_out
       WHERE a.status = 'confirmed' AND b.status = 'confirmed'
       ORDER BY a.check_in LIMIT 50`,
    );
    out.push(doubleBookingCheck(rows.map((r) => ({ aIn: r.a_in, aOut: r.a_out, bIn: r.b_in, bOut: r.b_out }))));
  } catch (error) {
    logger.warn({ err: error, check: "integrity:double_booking" }, "Ops watch could not run an integrity check");
    out.push(...stillOpen("integrity:double_booking"));
  }
  try {
    // 15 min grace: the webhook confirms the booking right after marking the order paid.
    // A live refund (same set as cashfree-rules LIVE_REFUND) explains a cancelled booking.
    const { rows } = await pool.query<{ check_in: string | null; check_out: string | null; booking_status: string | null }>(
      `SELECT e.check_in::text AS check_in, e.check_out::text AS check_out, b.status::text AS booking_status
       FROM gateway_orders o
       JOIN payment_requests r ON r.id = o.payment_request_id
       JOIN enquiries e ON e.id = r.enquiry_id
       LEFT JOIN bookings b ON b.id = e.converted_booking_id
       WHERE o.status = 'PAID' AND o.paid_at < now() - interval '15 minutes' AND o.paid_at > now() - interval '60 days'
         AND b.status IS DISTINCT FROM 'confirmed'
         AND NOT EXISTS (SELECT 1 FROM gateway_refunds f WHERE f.gateway_order_id = o.id
                         AND f.status IN ('SUCCESS', 'PENDING', 'PENDING_APPROVAL', 'ONHOLD'))
       ORDER BY o.paid_at LIMIT 50`,
    );
    out.push(paidNotBookedCheck(rows.map((r) => ({ checkIn: r.check_in, checkOut: r.check_out, bookingStatus: r.booking_status }))));
  } catch (error) {
    logger.warn({ err: error, check: "integrity:paid_not_booked" }, "Ops watch could not run an integrity check");
    out.push(...stillOpen("integrity:paid_not_booked"));
  }
  try {
    const { events, issues } = await auditCalendar();
    out.push(
      blockWithoutBookingCheck(
        events.filter((e) => issues.has(e.id)).map((e) => ({ startDate: e.startDate, endDate: e.endDate, issue: issues.get(e.id)! })),
      ),
    );
  } catch (error) {
    logger.warn({ err: error, check: "integrity:block_unexplained" }, "Ops watch could not run an integrity check");
    out.push(...stillOpen("integrity:block_unexplained"));
  }
  return out;
}

export async function runOpsWatch(now = new Date()): Promise<void> {
  const results = await runChecks(now);
  for (const r of results) labels[r.id] = r.label;
  lastResults = results;
  const out = step(states, withMissingAsOk(states, results, labels), now);
  states = out.states;
  const day = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  for (const event of out.events) {
    const alert = alertFor(event, day);
    logger.warn({ ops: event.kind, check: event.check.id, severity: event.check.severity }, alert.title);
    await notifyOwner({ event: "ops_incident", ...alert, href: "/admin", email: { subject: alert.title, text: alert.body } }, now);
  }
}

export function opsStatus() {
  return publicStatus(states, labels);
}

/** Open incidents with their owner-facing (sanitised) summaries, for Ryan's private digest. */
export function openIncidents() {
  return Object.entries(states)
    .filter(([, s]) => s.failing)
    .map(([id, s]) => ({ id, label: labels[id] ?? id, severity: s.severity, since: s.openedAt, summary: lastResults.find((r) => r.id === id)?.summary ?? "" }));
}

let started = false;
let running = false;

export function startOpsWatch(): void {
  if (started) return;
  started = true;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runOpsWatch();
    } catch (error) {
      logger.error({ err: error }, "Ops watch failed");
    } finally {
      running = false;
    }
  };
  // After every job's first run (the slowest starts at 45 s).
  setTimeout(() => void tick(), 3 * 60_000).unref?.();
  setInterval(() => void tick(), 5 * 60_000).unref?.();
  logger.info({ jobs: Object.keys(JOBS) }, "Ops watch scheduled");
}
