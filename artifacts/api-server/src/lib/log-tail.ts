import { logEntryFrom, type LogEntry } from "./ops-rules.ts";

/**
 * The last warnings and errors, in memory, for Ryan's private digest
 * (/api/ops/digest). Fed by a pino hook in logger.ts; never throws.
 */
// shortcut: memory only, so a restart empties it; Ryan polls every 5 minutes, which is enough for triage.
const MAX = 200;
const entries: LogEntry[] = [];

export function recordLog(args: readonly unknown[], level: number): void {
  try {
    const entry = logEntryFrom(args, level, new Date());
    if (!entry) return;
    entries.push(entry);
    if (entries.length > MAX) entries.shift();
  } catch {
    // Logging must never break because of the digest.
  }
}

export function recentLogs(limit = 60): LogEntry[] {
  return entries.slice(-limit);
}
