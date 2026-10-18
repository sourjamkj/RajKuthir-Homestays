/**
 * A per-key fixed-window counter for the public Book & Pay endpoints.
 *
 * In memory, like the enquiry form's throttle: one server process, and a
 * restart forgiving everyone is an acceptable failure for a homestay. What it
 * must never do is grow without bound, so expired keys are swept.
 */
export type Limiter = (key: string, now?: number) => boolean;

export function createLimiter(maxPerWindow: number, windowMs: number): Limiter {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (key, now = Date.now()) => {
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 2000) {
        for (const [candidate, value] of hits) {
          if (value.resetAt <= now) hits.delete(candidate);
        }
      }
      return false;
    }

    entry.count += 1;
    return entry.count > maxPerWindow;
  };
}
