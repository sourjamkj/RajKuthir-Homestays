import { z } from "zod";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const BlockDatesBody = z
  .object({
    startDate: isoDate,
    endDate: isoDate,
    title: z.string().trim().min(3, "Add a reason for blocking these dates (e.g. family visit, repairs).").max(120)
      .refine((t) => t !== "Blocked by host", "Add a reason for blocking these dates (e.g. family visit, repairs)."),
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
  /** Set when nothing explains this block: no booking behind it, or an owner block without a reason. */
  issue: z.enum(["no_booking", "no_reason"]).optional(),
});

export type CalendarEventDto = z.infer<typeof CalendarEventDto>;