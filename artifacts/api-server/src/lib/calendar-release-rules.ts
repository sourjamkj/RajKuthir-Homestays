/**
 * Releasing nights the owner blocked.
 *
 * A manual block goes out in the site's iCal feed; Booking.com and Airbnb
 * each close the night, and their own feeds bring it back as "Not available".
 * The site's feed to one OTA carries the other OTA's copy, so once the
 * manual block is deleted the two copies keep each other alive and the night
 * never reopens.
 *
 * So a release is remembered for a while: OTA feed events lying wholly inside
 * a released range are dropped at import until the OTAs have fetched the feed
 * without the block and reopened the night themselves.
 *
 * shortcut: a real OTA booking on exactly the released nights, seen only in
 * the iCal feed, is ignored for RELEASE_HOURS; bookings also arrive by email
 * into the ledger, which still blocks the night. Upgrade if an OTA with no
 * email import is added.
 */
export type Release = { startDate: string; endDate: string; until: string };

export const RELEASE_HOURS = 48;

export function newRelease(startDate: string, endDate: string, now: Date): Release {
  return { startDate, endDate, until: new Date(now.getTime() + RELEASE_HOURS * 3_600_000).toISOString() };
}

export function activeReleases(list: Release[], now: Date): Release[] {
  return list.filter((r) => r.until > now.toISOString());
}

/** True when the event's nights all fall inside a released range. */
export function isReleased(event: { startDate: string; endDate: string }, releases: Release[]): boolean {
  return releases.some((r) => event.startDate >= r.startDate && event.endDate <= r.endDate);
}
