import { createInsertSchema } from "drizzle-zod";
import {
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const calendarSourceEnum = pgEnum("calendar_source", [
  "manual",
  "direct",
  "bookingCom",
  "airbnb",
  "makeMyTrip",
]);

export const calendarStatusEnum = pgEnum("calendar_status", [
  "confirmed",
  "cancelled",
]);

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: calendarSourceEnum("source").notNull(),
    externalUid: text("external_uid"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    status: calendarStatusEnum("status").notNull().default("confirmed"),
    title: text("title"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    sourceUidUnique: uniqueIndex("calendar_source_uid_uniq").on(
      table.source,
      table.externalUid,
    ),
    rangeIdx: index("calendar_range_idx").on(
      table.startDate,
      table.endDate,
    ),
    sourceIdx: index("calendar_source_idx").on(table.source),
  }),
);

export const insertCalendarEventSchema = createInsertSchema(calendarEvents);
export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type NewCalendarEvent = typeof calendarEvents.$inferInsert;