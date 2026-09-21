/**
 * Choosing a stay by clicking the availability calendar.
 *
 * A block holds every night from its start date up to, but not including,
 * its end date — the same half-open rule the server uses, so arriving the
 * morning somebody else leaves is not a clash, and a check-out may land on
 * the very day the next booking begins.
 *
 * Everything here works on plain `yyyy-mm-dd` strings. They sort and compare
 * correctly with `<` and `>`, so there are no Date objects in this file and
 * no timezone to get wrong — the calendar grid and the form both speak the
 * same string, which is why the two stay in step without syncing state.
 */

export type StayBlock = { start: string; end: string };

export type StaySelection = { checkIn: string; checkOut: string };

/**
 * The first held night on or after `day`, or null if the calendar is clear
 * from there on.
 *
 * This is the one primitive the rest of the file is built from: it answers
 * both "is this night taken" (the answer is `day` itself) and "how far can a
 * stay starting here run" (the answer is where it must stop).
 */
export function firstHeldNightFrom(
  blocks: readonly StayBlock[],
  day: string,
): string | null {
  let earliest: string | null = null;

  for (const block of blocks) {
    // Ends on or before this day, so it holds nothing from here on.
    if (block.end <= day) continue;

    // Either the block starts later, or it is already running — in which
    // case the night we were asked about is itself held.
    const held = block.start > day ? block.start : day;
    if (earliest === null || held < earliest) earliest = held;
  }

  return earliest;
}

/** Is this single night already taken? */
export function isNightHeld(
  blocks: readonly StayBlock[],
  day: string,
): boolean {
  return firstHeldNightFrom(blocks, day) === day;
}

/**
 * The latest check-out a stay beginning on `checkIn` could have, or null when
 * nothing stands in the way. Equal to the next booking's start date: that
 * night belongs to them, and a check-out claims no night at all.
 */
export function latestCheckOut(
  blocks: readonly StayBlock[],
  checkIn: string,
): string | null {
  return firstHeldNightFrom(blocks, checkIn);
}

/** Are all the nights from `checkIn` up to (not including) `checkOut` free? */
export function stayIsFree(
  blocks: readonly StayBlock[],
  checkIn: string,
  checkOut: string,
): boolean {
  if (!checkIn || !checkOut || checkOut <= checkIn) return false;

  const held = firstHeldNightFrom(blocks, checkIn);
  return held === null || held >= checkOut;
}

/**
 * What one click on `day` should do to the current selection.
 *
 * Two rules keep this forgiving: a click that cannot extend the current
 * selection starts a new one rather than doing nothing, and a range that
 * would run through somebody else's booking is never produced. So the guest
 * can always click their way out of a wrong choice, and the dates that reach
 * the form are dates the host could actually accept.
 */
export function nextStaySelection(
  current: StaySelection,
  day: string,
  blocks: readonly StayBlock[],
): StaySelection {
  const fresh: StaySelection = { checkIn: day, checkOut: '' };

  // Nothing chosen yet, or a finished range — begin again from here.
  if (!current.checkIn || current.checkOut) return fresh;

  // Clicking at or before the check-in moves the check-in.
  if (day <= current.checkIn) return fresh;

  return stayIsFree(blocks, current.checkIn, day)
    ? { checkIn: current.checkIn, checkOut: day }
    : fresh;
}
