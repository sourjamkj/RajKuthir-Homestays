import { z } from "zod";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const BlockDatesBody = z
  .object({
    startDate: isoDate,
    endDate: isoDate,
    title: z.string().trim().max(120).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((value) => value.startDate < value.endDate, {
    message: "Check-out (endDate) must be after check-in (startDate).",
    path: ["endDate"],
  });

export const CalendarEventDto = z.object({
  id: z.string(),
  source: z.enum(["manual", "direct", "bookingCom", "airbnb", "makeMyTrip"]),
  startDate: isoDate,
  endDate: isoDate,
  title: z.string().nullable(),
  note: z.string().nullable().optional(),
  editable: z.boolean(),
});

export type CalendarEventDto = z.infer<typeof CalendarEventDto>;