import { and, asc, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  calendarEvents,
  type CalendarEvent,
  type NewCalendarEvent,
} from "@workspace/db";

export type CalendarSource = CalendarEvent["source"];

export const OWNED_SOURCES: CalendarSource[] = ["manual", "direct"];

export async function listAllEvents(): Promise<CalendarEvent[]> {
  return db
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.status, "confirmed"))
    .orderBy(asc(calendarEvents.startDate));
}

export async function listPublicBlocks(): Promise<
  Array<{ startDate: string; endDate: string }>
> {
  return db
    .select({
      startDate: calendarEvents.startDate,
      endDate: calendarEvents.endDate,
    })
    .from(calendarEvents)
    .where(eq(calendarEvents.status, "confirmed"))
    .orderBy(asc(calendarEvents.startDate));
}

export async function listFeedEvents(
  excludeSource?: CalendarSource,
): Promise<CalendarEvent[]> {
  const where = excludeSource
    ? and(
        eq(calendarEvents.status, "confirmed"),
        ne(calendarEvents.source, excludeSource),
      )
    : eq(calendarEvents.status, "confirmed");

  return db
    .select()
    .from(calendarEvents)
    .where(where)
    .orderBy(asc(calendarEvents.startDate));
}

export async function createManualBlock(input: {
  startDate: string;
  endDate: string;
  title?: string | null;
  note?: string | null;
}): Promise<CalendarEvent> {
  const [row] = await db
    .insert(calendarEvents)
    .values({
      source: "manual",
      externalUid: null,
      startDate: input.startDate,
      endDate: input.endDate,
      title: input.title ?? "Blocked by host",
      note: input.note ?? null,
      status: "confirmed",
    })
    .returning();

  return row;
}

export async function deleteOwnedEvent(id: string): Promise<boolean> {
  const deleted = await db
    .delete(calendarEvents)
    .where(
      and(
        eq(calendarEvents.id, id),
        inArray(calendarEvents.source, OWNED_SOURCES),
      ),
    )
    .returning({ id: calendarEvents.id });

  return deleted.length > 0;
}

export async function replaceSourceEvents(
  source: Exclude<CalendarSource, "manual" | "direct">,
  events: Array<{
    externalUid: string;
    startDate: string;
    endDate: string;
    title?: string | null;
  }>,
): Promise<number> {
  return db.transaction(async (transaction) => {
    await transaction
      .delete(calendarEvents)
      .where(eq(calendarEvents.source, source));

    if (events.length === 0) return 0;

    const rows: NewCalendarEvent[] = events.map((event) => ({
      source,
      externalUid: event.externalUid,
      startDate: event.startDate,
      endDate: event.endDate,
      title: event.title ?? "Reserved",
      status: "confirmed",
    }));

    await transaction.insert(calendarEvents).values(rows);
    return rows.length;
  });
}