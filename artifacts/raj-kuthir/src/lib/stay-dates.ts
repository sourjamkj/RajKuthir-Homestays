/**
 * Choosing a stay by clicking or dragging across the availability calendar.
 *
 * A block holds every night from its start date up to, but not including,
 * its end date — the same half-open rule the server uses, so arriving the
 * morning somebody else leaves is not a clash, and a check-out may land on
 * the very day the next booking begins.
 *
 * Everything here works on plain `yyyy-mm-dd` strings. They sort and compare
 * correctly with `<` and `>`, so there are no Date objects in the comparisons
 * and no timezone to get wrong — the calendar grid and the form both speak
 * the same string, which is why the two stay in step without syncing state.
 */

export type StayBlock = { start: string; end: string };

export type StaySelection = { checkIn: string; checkOut: string };

/** The only place a date is taken apart, so the arithmetic is wrong in at most one place. */
function shiftDay(day: string, by: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + by)).toISOString().slice(0, 10);
}

/**
 * The first held night on or after `day`, or null if the calendar is clear
 * from there on.
 *
 * This is the primitive most of the file is built from: it answers both "is
 * this night taken" (the answer is `day` itself) and "how far can a stay
 * starting here run" (the answer is where it must stop).
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

/**
 * The earliest check-in a stay ending on `checkOut` could have — the morning
 * after the last night somebody else holds. Null when nothing is in the way.
 *
 * The mirror of latestCheckOut, and the reason dragging the check-in handle
 * backwards stops in the right place instead of swallowing a booking.
 */
export function earliestCheckIn(
  blocks: readonly StayBlock[],
  checkOut: string,
): string | null {
  let lastHeld: string | null = null;

  for (const block of blocks) {
    // Starts on or after the check-out, so none of its nights are in the way.
    if (block.start >= checkOut) continue;

    // The block's last night that falls before the check-out.
    const stopsAt = block.end < checkOut ? block.end : checkOut;
    const night = shiftDay(stopsAt, -1);

    if (night >= block.start && (lastHeld === null || night > lastHeld)) {
      lastHeld = night;
    }
  }

  return lastHeld === null ? null : shiftDay(lastHeld, 1);
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
 * The stay a drag describes: one end pinned at `anchor`, the other following
 * the pointer to `day`.
 *
 * Dragging clamps rather than refuses. Run the pointer across somebody else's
 * booking and the highlight stops at their door instead of vanishing, which
 * both keeps the range legal and shows the guest exactly why it stopped.
 *
 * The anchor is whichever end is standing still — the pressed day for a new
 * range, the opposite end when a handle is being dragged — so all three
 * gestures come back through here.
 */
export function stayFromDrag(
  blocks: readonly StayBlock[],
  anchor: string,
  day: string,
): StaySelection {
  if (day > anchor) {
    const ceiling = latestCheckOut(blocks, anchor);
    const checkOut = ceiling !== null && day > ceiling ? ceiling : day;
    return checkOut > anchor
      ? { checkIn: anchor, checkOut }
      : { checkIn: anchor, checkOut: '' };
  }

  if (day < anchor) {
    const floor = earliestCheckIn(blocks, anchor);
    const checkIn = floor !== null && day < floor ? floor : day;
    return checkIn < anchor
      ? { checkIn, checkOut: anchor }
      : { checkIn: anchor, checkOut: '' };
  }

  // Pressed and released on one day: a check-in waiting for its check-out.
  return { checkIn: anchor, checkOut: '' };
}

/**
 * What one click on `day` should do to the current selection.
 *
 * Three rules keep this forgiving. A click that cannot extend the selection
 * starts a new one rather than doing nothing, so the guest can always click
 * their way out of a wrong choice. A click past the check-in of a finished
 * range moves the check-out, so a stay can be adjusted in place instead of
 * being cleared and rebuilt. And a range that would run through somebody
 * else's booking is never produced.
 */
export function nextStaySelection(
  current: StaySelection,
  day: string,
  blocks: readonly StayBlock[],
): StaySelection {
  const fresh: StaySelection = { checkIn: day, checkOut: '' };

  // Nothing chosen yet — begin here.
  if (!current.checkIn) return fresh;

  // Clicking at or before the check-in always moves the check-in, whether or
  // not the range is finished. That is how the guest re-picks from the front.
  if (day <= current.checkIn) return fresh;

  // Past the check-in: set the check-out, or move it if one is already there.
  return stayIsFree(blocks, current.checkIn, day)
    ? { checkIn: current.checkIn, checkOut: day }
    : fresh;
}
