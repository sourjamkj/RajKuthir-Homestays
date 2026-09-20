import { and, eq, gt, inArray, isNotNull, lte, ne } from "drizzle-orm";
import {
  appSettings,
  bookings,
  calendarEvents,
  db,
  enquiries,
  guestOnboarding,
} from "@workspace/db";
import {
  MAX_ITEMS,
  activityWindowStart,
  buildActivity,
  type ActivityItem,
} from "./activity-rules";

/**
 * The owner's "last looked at the activity panel" marker.
 *
 * One value, in app_settings, because there is one owner login. Kept on the
 * server rather than in the browser so that reading it on the phone also
 * clears it on the laptop.
 */
const SEEN_KEY = "admin.activity_seen_at";

async function readSeenAt(): Promise<Date | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, SEEN_KEY));
  return row?.value ? new Date(row.value) : null;
}

export async function markActivitySeen(at: Date): Promise<void> {
  const value = at.toISOString();
  await db
    .insert(appSettings)
    .values({ key: SEEN_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

const OTA_SOURCES = ["bookingCom", "airbnb", "makeMyTrip"] as const;

export async function listActivity(now = new Date()): Promise<{
  since: string;
  items: ActivityItem[];
}> {
  const since = activityWindowStart(await readSeenAt(), now);

  const [newBookings, cancelledBookings, otaBlocks, newEnquiries, uploads] = await Promise.all([
    db
      .select({
        id: bookings.id,
        source: bookings.source,
        guestName: bookings.guestName,
        guestPhone: bookings.guestPhone,
        checkIn: bookings.checkIn,
        checkOut: bookings.checkOut,
        createdAt: bookings.createdAt,
      })
      .from(bookings)
      .where(and(gt(bookings.createdAt, since), lte(bookings.createdAt, now)))
      .limit(MAX_ITEMS),

    // Cancelled after the marker, but created before it — a booking made and
    // cancelled inside the same window shows once, as new, not twice.
    db
      .select({
        id: bookings.id,
        source: bookings.source,
        guestName: bookings.guestName,
        checkIn: bookings.checkIn,
        checkOut: bookings.checkOut,
        updatedAt: bookings.updatedAt,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "cancelled"),
          gt(bookings.updatedAt, since),
          lte(bookings.createdAt, since),
        ),
      )
      .limit(MAX_ITEMS),

    db
      .select({
        id: calendarEvents.id,
        source: calendarEvents.source,
        startDate: calendarEvents.startDate,
        endDate: calendarEvents.endDate,
        createdAt: calendarEvents.createdAt,
      })
      .from(calendarEvents)
      .where(
        and(
          inArray(calendarEvents.source, [...OTA_SOURCES]),
          ne(calendarEvents.status, "cancelled"),
          gt(calendarEvents.createdAt, since),
        ),
      )
      .limit(MAX_ITEMS),

    db
      .select({
        id: enquiries.id,
        name: enquiries.name,
        checkIn: enquiries.checkIn,
        checkOut: enquiries.checkOut,
        createdAt: enquiries.createdAt,
      })
      .from(enquiries)
      .where(gt(enquiries.createdAt, since))
      .limit(MAX_ITEMS),

    db
      .select({
        bookingId: guestOnboarding.bookingId,
        guestName: bookings.guestName,
        checkIn: bookings.checkIn,
        completedAt: guestOnboarding.completedAt,
      })
      .from(guestOnboarding)
      .innerJoin(bookings, eq(bookings.id, guestOnboarding.bookingId))
      .where(and(isNotNull(guestOnboarding.completedAt), gt(guestOnboarding.completedAt, since)))
      .limit(MAX_ITEMS),
  ]);

  return {
    since: since.toISOString(),
    items: buildActivity({
      newBookings,
      cancelledBookings,
      otaBlocks,
      enquiries: newEnquiries,
      uploads: uploads.filter((u): u is typeof u & { completedAt: Date } => u.completedAt !== null),
    }),
  };
}
