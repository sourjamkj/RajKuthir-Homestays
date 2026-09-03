import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/admin-auth";
import { parseBookingSheet } from "../lib/booking-import";
import {
  createBooking,
  createExpense,
  deleteBooking,
  deleteExpense,
  getLedgerSummary,
  listBookings,
  listExpenses,
  listPayouts,
  toPaise,
  updateBooking,
  type BookingSource,
  type BookingStatus,
} from "../lib/ledger-repo";

const router: IRouter = Router();

// Every route here is owner-only: this is the business's financial record.
router.use("/ledger", requireAdmin);
router.use("/bookings", requireAdmin);
router.use("/expenses", requireAdmin);
router.use("/payouts", requireAdmin);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RUPEES = 100_000_000;

const SOURCES: readonly BookingSource[] = [
  "manual",
  "direct",
  "bookingCom",
  "airbnb",
  "makeMyTrip",
];

const STATUSES: readonly BookingStatus[] = [
  "pending",
  "confirmed",
  "cancelled",
];

const CATEGORIES = [
  "staff",
  "utilities",
  "maintenance",
  "supplies",
  "food",
  "marketing",
  "commission",
  "other",
] as const;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/**
 * Rupees in, paise out. Returns undefined when the field was absent (leave it
 * alone) and null when it was explicitly cleared — the two mean different
 * things on a PATCH.
 */
function money(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  const rupees = Number(value);
  if (!Number.isFinite(rupees) || rupees < 0 || rupees > MAX_RUPEES) {
    throw new Error("Enter an amount between 0 and 10,00,00,000.");
  }

  return toPaise(rupees);
}

function text(value: unknown, max = 200): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim().slice(0, max);
  return trimmed || null;
}

function count(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new Error("Enter a whole number between 0 and 100.");
  }
  return parsed;
}

router.get("/ledger/summary", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await getLedgerSummary());
});

router.get("/bookings", async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;

  res.setHeader("Cache-Control", "no-store");
  res.json({ bookings: await listBookings({ from, to }) });
});

router.post("/bookings", async (req, res) => {
  const body = req.body ?? {};
  const source = String(body.source ?? "manual") as BookingSource;
  const checkIn = String(body.checkIn ?? "");
  const checkOut = String(body.checkOut ?? "");

  if (!SOURCES.includes(source)) {
    res.status(400).json({ error: "Choose a valid booking channel." });
    return;
  }

  if (!ISO_DATE.test(checkIn) || !ISO_DATE.test(checkOut)) {
    res.status(400).json({ error: "Choose valid check-in and check-out dates." });
    return;
  }

  if (checkOut <= checkIn) {
    res.status(400).json({ error: "Check-out must be after check-in." });
    return;
  }

  const status = String(body.status ?? "confirmed") as BookingStatus;
  if (!STATUSES.includes(status)) {
    res.status(400).json({ error: "Choose a valid booking status." });
    return;
  }

  try {
    const created = await createBooking({
      source,
      checkIn,
      checkOut,
      status,
      externalRef: text(body.externalRef) ?? null,
      guestName: text(body.guestName) ?? null,
      guestPhone: text(body.guestPhone, 40) ?? null,
      guests: count(body.guests) ?? null,
      pets: count(body.pets) ?? null,
      grossPaise: money(body.gross) ?? null,
      commissionPaise: money(body.commission) ?? null,
      taxPaise: money(body.tax) ?? null,
      receivedPaise: money(body.received) ?? null,
      note: text(body.note, 500) ?? null,
    });

    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Could not save booking.",
    });
  }
});

/**
 * Bulk import from a spreadsheet.
 *
 * The client turns the file into raw cell arrays; validation happens here, so
 * the browser can never talk the server into accepting a row it would reject
 * on its own. Defaults to a dry run — `commit: true` is required to write
 * anything, so the owner always sees exactly what will be created first.
 */
router.post("/bookings/import", async (req, res) => {
  const rows = req.body?.rows;

  if (!Array.isArray(rows)) {
    res.status(400).json({ error: "No spreadsheet rows were received." });
    return;
  }

  if (rows.length > 5000) {
    res.status(400).json({
      error: "That sheet has more than 5,000 rows. Split it and import in parts.",
    });
    return;
  }

  const parsed = parseBookingSheet(rows as unknown[][]);

  if (parsed.missingColumns.length > 0) {
    res.status(400).json({
      error: `The sheet needs a ${parsed.missingColumns.join(" and ")} column.`,
      missingColumns: parsed.missingColumns,
    });
    return;
  }

  const commit = req.body?.commit === true;

  if (!commit) {
    res.json({ ...parsed, committed: false });
    return;
  }

  let created = 0;
  const failures: Array<{ rowNumber: number; error: string }> = [];

  for (const row of parsed.rows) {
    if (!row.booking) continue;

    try {
      await createBooking({
        ...row.booking,
        externalRef: null,
        taxPaise: null,
        pets: null,
      });
      created += 1;
    } catch (error) {
      failures.push({
        rowNumber: row.rowNumber,
        error:
          error instanceof Error ? error.message : "Could not save this row.",
      });
    }
  }

  res.json({
    ...parsed,
    committed: true,
    created,
    failures,
  });
});

router.patch("/bookings/:id", async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;

  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid booking id." });
    return;
  }

  const body = req.body ?? {};
  const patch: Record<string, unknown> = {};

  try {
    if (body.status !== undefined) {
      const status = String(body.status) as BookingStatus;
      if (!STATUSES.includes(status)) {
        res.status(400).json({ error: "Choose a valid booking status." });
        return;
      }
      patch.status = status;
    }

    if (body.checkIn !== undefined) {
      if (!ISO_DATE.test(String(body.checkIn))) {
        res.status(400).json({ error: "Choose a valid check-in date." });
        return;
      }
      patch.checkIn = String(body.checkIn);
    }

    if (body.checkOut !== undefined) {
      if (!ISO_DATE.test(String(body.checkOut))) {
        res.status(400).json({ error: "Choose a valid check-out date." });
        return;
      }
      patch.checkOut = String(body.checkOut);
    }

    if (
      typeof patch.checkIn === "string" &&
      typeof patch.checkOut === "string" &&
      patch.checkOut <= patch.checkIn
    ) {
      res.status(400).json({ error: "Check-out must be after check-in." });
      return;
    }

    const assign = (key: string, value: unknown) => {
      if (value !== undefined) patch[key] = value;
    };

    assign("guestName", text(body.guestName));
    assign("guestPhone", text(body.guestPhone, 40));
    assign("guests", count(body.guests));
    assign("pets", count(body.pets));
    assign("grossPaise", money(body.gross));
    assign("commissionPaise", money(body.commission));
    assign("taxPaise", money(body.tax));
    assign("receivedPaise", money(body.received));
    assign("note", text(body.note, 500));

    const updated = await updateBooking(id, patch);

    if (!updated) {
      res.status(404).json({ error: "That booking no longer exists." });
      return;
    }

    res.json(updated);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Could not update booking.",
    });
  }
});

router.delete("/bookings/:id", async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;

  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid booking id." });
    return;
  }

  const removed = await deleteBooking(id);

  if (!removed) {
    res.status(404).json({ error: "That booking no longer exists." });
    return;
  }

  res.status(204).end();
});

router.get("/expenses", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ expenses: await listExpenses() });
});

router.post("/expenses", async (req, res) => {
  const body = req.body ?? {};
  const spentOn = String(body.spentOn ?? "");
  const category = String(body.category ?? "other");

  if (!ISO_DATE.test(spentOn)) {
    res.status(400).json({ error: "Choose a valid date." });
    return;
  }

  if (!(CATEGORIES as readonly string[]).includes(category)) {
    res.status(400).json({ error: "Choose a valid category." });
    return;
  }

  try {
    const amountPaise = money(body.amount);

    if (amountPaise === null || amountPaise === undefined || amountPaise <= 0) {
      res.status(400).json({ error: "Enter an amount greater than zero." });
      return;
    }

    const created = await createExpense({
      spentOn,
      amountPaise,
      category: category as (typeof CATEGORIES)[number],
      note: text(body.note, 300) ?? null,
    });

    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Could not save expense.",
    });
  }
});

router.delete("/expenses/:id", async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;

  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid expense id." });
    return;
  }

  const removed = await deleteExpense(id);

  if (!removed) {
    res.status(404).json({ error: "That expense no longer exists." });
    return;
  }

  res.status(204).end();
});

router.get("/payouts", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ payouts: await listPayouts() });
});

export default router;
