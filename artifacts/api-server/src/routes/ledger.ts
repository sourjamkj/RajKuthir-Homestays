import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/admin-auth";
import { logger } from "../lib/logger";
import { parseBookingSheet } from "../lib/booking-import";
import {
  backfillMissingReferences,
  createBooking,
  createExpense,
  deleteBooking,
  findClashes,
  mergeIntoBooking,
  deleteExpense,
  getLedgerSummary,
  listBookings,
  listExpenses,
  listPayouts,
  toPaise,
  updateBooking,
  type Clash,
  type BookingSource,
  type BookingStatus,
} from "../lib/ledger-repo";

const router: IRouter = Router();

/**
 * Bookings created before references existed need one, and there is no
 * migration step in this project to hang that on. Doing it once per process,
 * the first time the owner opens the ledger, keeps it self-healing without a
 * manual command — and costs one indexed query per boot thereafter.
 */
let referencesBackfilled = false;

async function ensureReferencesBackfilled(): Promise<void> {
  if (referencesBackfilled) return;
  referencesBackfilled = true;

  try {
    await backfillMissingReferences();
  } catch (error) {
    // Never take the ledger down over a backfill; it retries next boot.
    referencesBackfilled = false;
    logger.warn({ error }, "Could not backfill booking references");
  }
}

/** What the browser is told about a clash — enough to decide, no more. */
function toClashDto(clashes: Clash[]) {
  return clashes.map(({ kind, booking }) => ({
    kind,
    id: booking.id,
    reference: booking.reference,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    guestName: booking.guestName,
    source: booking.source,
    grossPaise: booking.grossPaise,
  }));
}

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
  await ensureReferencesBackfilled();
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
    // Dry run: tell the owner which rows would land on top of something.
    const rowsWithClashes = await Promise.all(
      parsed.rows.map(async (row) => {
        if (!row.booking) return { ...row, clashes: [] };

        const clashes = await findClashes({
          checkIn: row.booking.checkIn,
          checkOut: row.booking.checkOut,
          guestName: row.booking.guestName,
        });

        return { ...row, clashes: toClashDto(clashes) };
      }),
    );

    res.json({ ...parsed, rows: rowsWithClashes, committed: false });
    return;
  }

  /**
   * Per-row instructions from the review screen, keyed by row number:
   *
   *   import — create it anyway, clash and all (two genuine stays, one villa;
   *            the owner has seen the conflict and wants both on record)
   *   merge  — fold it into the booking it duplicates, filling only blanks
   *   skip   — discard the row
   *
   * A clashing row with NO instruction is skipped. Silence must never create a
   * double booking; that is the whole point of the review step.
   */
  const decisions: Record<string, string> =
    req.body?.decisions && typeof req.body.decisions === "object"
      ? (req.body.decisions as Record<string, string>)
      : {};

  let created = 0;
  let merged = 0;
  let skipped = 0;
  const failures: Array<{ rowNumber: number; error: string }> = [];

  for (const row of parsed.rows) {
    if (!row.booking) continue;

    const payload = {
      ...row.booking,
      externalRef: null,
      taxPaise: null,
      pets: null,
    };

    try {
      const clashes = await findClashes({
        checkIn: payload.checkIn,
        checkOut: payload.checkOut,
        guestName: payload.guestName,
      });

      const decision = decisions[String(row.rowNumber)];

      if (clashes.length === 0) {
        await createBooking(payload);
        created += 1;
        continue;
      }

      if (decision === "merge") {
        // Merge only into an exact duplicate. Folding a row into a stay that
        // merely overlaps would silently destroy a real second booking.
        const duplicate = clashes.find((clash) => clash.kind === "duplicate");

        if (!duplicate) {
          failures.push({
            rowNumber: row.rowNumber,
            error: "Nothing here to merge into — the dates overlap but do not match.",
          });
          continue;
        }

        await mergeIntoBooking(duplicate.booking.id, payload);
        merged += 1;
        continue;
      }

      if (decision === "import") {
        await createBooking(payload);
        created += 1;
        continue;
      }

      skipped += 1;
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
    merged,
    skipped,
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

    // A phone number set here is what WhatsApp links and reminders are sent
    // to, so it has to be dialable: 10–15 digits. A bare 10-digit number is an
    // Indian mobile typed without its code; store it with +91 so wa.me links
    // built from it reach India rather than wherever those digits point.
    const phone = text(body.guestPhone, 40);
    if (typeof phone === "string") {
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 15) {
        res.status(400).json({ error: "Enter a mobile number with 10–15 digits, e.g. +91 98765 43210." });
        return;
      }
      assign("guestPhone", digits.length === 10 ? `+91 ${digits}` : phone);
    } else {
      assign("guestPhone", phone);
    }
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
