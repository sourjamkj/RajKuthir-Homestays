/**
 * Whether a requested stay runs into dates that are already taken.
 *
 * Every range here is half-open — check-in inclusive, check-out exclusive —
 * the same convention as the calendar, the bookings ledger and the rate
 * overrides. That is what makes back-to-back stays work: one guest leaving on
 * the 5th and another arriving on the 5th do not collide, because the first
 * range ends where the second begins. Treating the end date as occupied would
 * reject a perfectly good booking on every changeover day, which is the
 * expensive direction to get this wrong.
 *
 * ISO dates compare correctly as strings, so there is no parsing here and no
 * timezone to get wrong.
 */

export type DateRange = { startDate: string; endDate: string };

/** True when the two half-open ranges share at least one night. */
export function rangesOverlap(left: DateRange, right: DateRange): boolean {
  return left.startDate < right.endDate && right.startDate < left.endDate;
}

/**
 * The first taken range the stay runs into, or null when the dates are clear.
 *
 * Returns the range rather than a boolean so the caller can say something
 * useful — an enquiry rejected with "those dates are taken" is a guest who
 * tries again, and one rejected with no explanation is a guest who leaves.
 */
export function firstConflict(
  stay: DateRange,
  taken: readonly DateRange[],
): DateRange | null {
  if (stay.endDate <= stay.startDate) return null;

  return taken.find((range) => rangesOverlap(stay, range)) ?? null;
}

export function isAvailable(
  stay: DateRange,
  taken: readonly DateRange[],
): boolean {
  return firstConflict(stay, taken) === null;
}
