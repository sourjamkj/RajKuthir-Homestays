/**
 * Ops watch, pure rules: what counts as broken, how serious it is, and when
 * to tell the owner. No DB, no network; ops-watch.ts feeds it.
 *
 * Deterministic first: every check here is a plain rule. Nothing calls an AI.
 */

export type Severity = "P0" | "P1" | "P2" | "P3";

const RANK: Record<Severity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export type CheckResult = {
  id: string;
  label: string;
  ok: boolean;
  severity: Severity;
  /** Owner-facing, already sanitised. Never shown on the public endpoint. */
  summary: string;
};

/** Background jobs the watch expects to hear from, and how often they run. */
export const JOBS = {
  calendar: { label: "OTA calendar sync", everyMs: 15 * 60_000, severity: "P1" },
  book_pay: { label: "Payments and holds (Book & Pay)", everyMs: 5 * 60_000, severity: "P1" },
  notifications: { label: "WhatsApp outbox", everyMs: 15 * 60_000, severity: "P1" },
  owner_alerts: { label: "Owner alerts", everyMs: 2 * 60_000, severity: "P1" },
  mail: { label: "OTA booking emails", everyMs: 15 * 60_000, severity: "P2" },
} as const satisfies Record<string, { label: string; everyMs: number; severity: Severity }>;

export type JobId = keyof typeof JOBS;

export type JobBeat = {
  startedAt: number;
  lastOk: number | null;
  lastError: string | null;
  failsInRow: number;
};

/** Silent for three runs, or failed three runs in a row. One bad run is noise. */
export function jobCheck(id: JobId, beat: JobBeat, now: number): CheckResult {
  const job = JOBS[id];
  const lastHeard = beat.lastOk ?? beat.startedAt;
  // First runs are delayed up to a minute after boot.
  const silentFor = now - lastHeard;
  const silent = silentFor > job.everyMs * 3 + 2 * 60_000;
  const failing = beat.failsInRow >= 3;
  const ok = !silent && !failing;
  const summary = ok
    ? `${job.label} is running.`
    : failing
      ? `${job.label} failed ${beat.failsInRow} runs in a row${beat.lastError ? `: ${sanitize(beat.lastError).slice(0, 160)}` : "."}`
      : `${job.label} has not completed a run for ${Math.round(silentFor / 60_000)} minutes.`;
  return { id: `job:${id}`, label: job.label, ok, severity: job.severity, summary };
}

export function databaseCheck(ok: boolean, error?: string): CheckResult {
  return {
    id: "database",
    label: "Database",
    ok,
    severity: "P0",
    summary: ok ? "Database answers." : `Database not answering${error ? `: ${sanitize(error).slice(0, 160)}` : "."}`,
  };
}

/** Guest messages due 45+ minutes ago (three outbox runs) that still have not gone. */
export function outboxCheck(stuck: number): CheckResult {
  return {
    id: "outbox",
    label: "WhatsApp messages waiting to send",
    ok: stuck === 0,
    severity: "P1",
    summary: stuck === 0 ? "Outbox is draining." : `${stuck} guest message${stuck === 1 ? " is" : "s are"} overdue in the outbox.`,
  };
}

/**
 * Strips what must never reach an alert, a log digest or an AI prompt:
 * tokens and keys, emails, phone numbers, long digit runs (UPI, accounts),
 * connection strings. Over-redacting is fine; leaking is not.
 */
export function sanitize(text: string): string {
  return text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s@/]+@[^\s]+/gi, "[connection-string]")
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    // Also api_key, client_secret, access_token, ?apikey=.
    .replace(/(key|token|secret|password|passwd|pwd|signature|authorization)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, "$1$2[redacted]")
    .replace(/\b(sk|pk|rk)[-_][A-Za-z0-9_-]{8,}/g, "[redacted-key]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    // Emails and UPI IDs (name@okaxis).
    .replace(/[\w.+-]+@[\w-]+(\.[\w.-]+)?/g, "[email]")
    // 10+ digits (phones, UPI refs, accounts), but not a date-time like 2026-11-23 13:24.
    .replace(/(?<![\d:-])\+?(?:\d[ -]?){9,14}\d(?![\d:])/g, "[number]");
}

/** What the watch remembers about each check between runs. */
export type CheckState = {
  failing: boolean;
  /** Consecutive runs that disagreed with `failing`. Two flip it. */
  streak: number;
  severity: Severity;
  openedAt: string | null;
  remindedDay: string | null;
};

export type OpsEvent = {
  kind: "opened" | "recovered" | "escalated" | "reminder";
  check: CheckResult;
  /** Incident identity: the check plus when it opened. Reopening is a new incident. */
  incident: string;
};

const CONFIRM_RUNS = 2;

/**
 * An open incident whose check stopped reporting (WhatsApp switched to manual,
 * job gone) counts as ok, so it closes instead of staying open forever.
 */
export function withMissingAsOk(
  states: Readonly<Record<string, CheckState>>,
  results: readonly CheckResult[],
  labels: Readonly<Record<string, string>>,
): CheckResult[] {
  const seen = new Set(results.map((r) => r.id));
  const missing = Object.entries(states)
    .filter(([id, s]) => s.failing && !seen.has(id))
    .map(([id, s]) => ({ id, label: labels[id] ?? id, ok: true, severity: s.severity, summary: "No longer being checked." }));
  return [...results, ...missing];
}

const istDay = (at: Date) => new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * One run of the incident state machine. Two agreeing runs open or close an
 * incident (no flapping), a worse severity escalates it, and a P0/P1 still
 * open reminds once per IST day. Everything else is silent.
 */
export function step(
  states: Readonly<Record<string, CheckState>>,
  results: readonly CheckResult[],
  now: Date,
): { states: Record<string, CheckState>; events: OpsEvent[] } {
  const next: Record<string, CheckState> = { ...states };
  const events: OpsEvent[] = [];
  const day = istDay(now);

  for (const result of results) {
    const s: CheckState = { ...(states[result.id] ?? { failing: false, streak: 0, severity: result.severity, openedAt: null, remindedDay: null }) };
    const disagrees = result.ok === s.failing;
    s.streak = disagrees ? s.streak + 1 : 0;

    if (disagrees && s.streak >= CONFIRM_RUNS) {
      s.streak = 0;
      if (result.ok) {
        events.push({ kind: "recovered", check: result, incident: `${result.id}@${s.openedAt}` });
        Object.assign(s, { failing: false, openedAt: null, remindedDay: null });
      } else {
        Object.assign(s, { failing: true, openedAt: now.toISOString(), remindedDay: day, severity: result.severity });
        events.push({ kind: "opened", check: result, incident: `${result.id}@${s.openedAt}` });
      }
    } else if (s.failing && !result.ok) {
      const incident = `${result.id}@${s.openedAt}`;
      if (RANK[result.severity] < RANK[s.severity]) {
        s.severity = result.severity;
        events.push({ kind: "escalated", check: result, incident });
      } else if (RANK[s.severity] <= RANK.P1 && s.remindedDay !== day) {
        s.remindedDay = day;
        events.push({ kind: "reminder", check: result, incident });
      }
    }
    next[result.id] = s;
  }
  return { states: next, events };
}

/** Owner alert wording for an event. The dedupe key makes a resend impossible. */
export function alertFor(event: OpsEvent, day: string): { title: string; body: string; dedupeKey: string } {
  const { check } = event;
  const title =
    event.kind === "recovered"
      ? `Recovered: ${check.label}`
      : event.kind === "escalated"
        ? `${check.severity} now: ${check.label}`
        : event.kind === "reminder"
          ? `Still broken (${check.severity}): ${check.label}`
          : `${check.severity}: ${check.label}`;
  const suffix = event.kind === "reminder" ? `:${day}` : "";
  return { title, body: check.summary, dedupeKey: `ops:${event.kind}:${event.incident}${suffix}` };
}

/**
 * Public health: overall status only. 503 only for an open P0 (server or
 * database), which the server may be unable to report itself. P1/P2 reach the
 * owner through the app alerts; a 503 for them would make the outside monitor
 * email every 15 minutes for one incident.
 */
export function publicStatus(states: Readonly<Record<string, CheckState>>, labels: Readonly<Record<string, string>>) {
  const open = Object.entries(states).filter(([, s]) => s.failing);
  const serious = open.some(([, s]) => s.severity === "P0");
  return {
    httpStatus: serious ? 503 : 200,
    body: {
      status: serious ? "down" : open.length ? "degraded" : "ok",
      open: open.map(([id, s]) => ({ check: labels[id] ?? id, severity: s.severity, since: s.openedAt })),
    },
  };
}

/** One warning or error line kept for Ryan's digest. Already sanitised. */
export type LogEntry = { at: string; level: "warn" | "error" | "fatal"; msg: string; error?: string; stack?: string[]; where?: string };

/**
 * Turns a pino call (its args and numeric level) into a digest line, or null
 * below warn. Keeps the message, the error and the top of its stack, plus
 * path/source/check context; drops everything else (bodies, guests, payloads).
 */
export function logEntryFrom(args: readonly unknown[], level: number, now: Date): LogEntry | null {
  if (level < 40) return null;
  const [first, second] = args;
  const obj = first && typeof first === "object" && !(first instanceof Error) ? (first as Record<string, unknown>) : {};
  const err = first instanceof Error ? first : (obj["err"] ?? obj["error"]);
  const msg = typeof first === "string" ? first : typeof second === "string" ? second : err instanceof Error ? err.message : "";
  const where = ["path", "source", "check", "event", "table"].map((k) => obj[k]).find((v) => typeof v === "string") as string | undefined;
  const entry: LogEntry = { at: now.toISOString(), level: level >= 60 ? "fatal" : level >= 50 ? "error" : "warn", msg: sanitize(msg).slice(0, 300) };
  if (err instanceof Error) {
    // Drizzle wraps DB errors as "Failed query: <sql>\nparams: <values>" with the real error in `cause`;
    // params can hold guest names, so they never leave.
    const cause = err.cause instanceof Error ? ` ← ${err.cause.message}` : "";
    entry.error = sanitize(err.message.split("\nparams:")[0]! + cause).slice(0, 400);
    entry.stack = (err.stack ?? "").split("\n").slice(1, 7).map((line) => sanitize(line.trim()));
  } else if (typeof err === "string") entry.error = sanitize(err).slice(0, 300);
  if (where) entry.where = sanitize(where).slice(0, 120);
  return entry;
}
