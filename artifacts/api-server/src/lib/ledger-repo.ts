import { and, asc, desc, eq, gt, gte, isNull, lt, lte, sql } from "drizzle-orm";
import {
  db,
  bookings,
  expenses,
  payouts,
  type Booking,
  type Expense,
  type Payout,
} from "@workspace/db";
import { buildReference } from "./booking-reference";

/**
 * Money crosses this boundary in rupees (what the owner types and reads) and
 * is stored in paise (integer). These two functions are the only place that
 * conversion should happen.
 */
export const toPaise = (rupees: number): number => Math.round(rupees * 100);
export const toRupees = (paise: number): number => paise / 100;

export type BookingSource = Booking["source"];
export type BookingStatus = Booking["status"];

export type BookingInput = {
  source: BookingSource;
  externalRef?: string | null;
  guestName?: string | null;
  guestPhone?: string | null;
  checkIn: string;
  checkOut: string;
  guests?: number | null;
  pets?: number | null;
  status?: BookingStatus;
  grossPaise?: number | null;
  commissionPaise?: number | null;
  taxPaise?: number | null;
  receivedPaise?: number | null;
  note?: string | null;
  importedFromEmail?: string | null;
  /** Normally omitted — createBooking issues one. Set only when re-homing a row. */
  reference?: string | null;
};

export async function listBookings(range?: {
  from?: string;
  to?: string;
}): Promise<Booking[]> {
  const filters = [];
  if (range?.from) filters.push(gte(bookings.checkIn, range.from));
  if (range?.to) filters.push(lte(bookings.checkIn, range.to));

  return db
    .select()
    .from(bookings)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(bookings.checkIn));
}

/** Postgres unique-violation. A fresh reference is generated and retried. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505"
  );
}

const REFERENCE_ATTEMPTS = 5;

/**
 * Every booking gets a Raj Kuthir reference, whichever way it arrived — typed
 * in, imported, or synced from a channel. It is the guest's key to /welcome and
 * the id an online payment would later be raised against, so there is no such
 * thing here as a booking without one.
 *
 * Collisions are astronomically unlikely but not impossible, and the unique
 * index is what decides. Retrying on 23505 is cheaper and more honest than
 * pre-checking with a SELECT, which races.
 */
export async function createBooking(input: BookingInput): Promise<Booking> {
  let lastError: unknown;

  for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
    try {
      const [created] = await db
        .insert(bookings)
        .values({
          ...input,
          reference: input.reference ?? buildReference(input.checkIn),
          updatedAt: new Date(),
        })
        .returning();

      return created!;
    } catch (error) {
      lastError = error;
      if (!isUniqueViolation(error)) throw error;
    }
  }

  throw lastError ?? new Error("Could not allocate a booking reference.");
}

/**
 * Gives a reference to any booking saved before references existed. Idempotent
 * and safe to call repeatedly; does nothing once every row has one.
 */
export async function backfillMissingReferences(): Promise<number> {
  const rows = await db
    .select({ id: bookings.id, checkIn: bookings.checkIn })
    .from(bookings)
    .where(isNull(bookings.reference));

  let filled = 0;

  for (const row of rows) {
    for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
      try {
        await db
          .update(bookings)
          .set({ reference: buildReference(row.checkIn) })
          .where(eq(bookings.id, row.id));
        filled += 1;
        break;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
  }

  return filled;
}

/** Punctuation, case and spacing are not part of a guest's identity. */
function normaliseName(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export type ClashKind = "duplicate" | "overlap";

export type Clash = { kind: ClashKind; booking: Booking };

/**
 * Anything already occupying these nights.
 *
 * Sobuj Potro is let as one whole villa, so two confirmed stays sharing even a
 * single night is a real double booking, not merely untidy data — which is why
 * this looks for overlap rather than for identical dates.
 *
 * A clash counts as a "duplicate" only when the dates match exactly AND the
 * guest name matches: that is the same reservation entered twice, and it is
 * safe to merge. Anything else is an "overlap" and wants a human to look at it.
 */
export async function findClashes(input: {
  checkIn: string;
  checkOut: string;
  guestName?: string | null;
  excludeId?: string;
}): Promise<Clash[]> {
  const rows = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.status, "confirmed"),
        // Half-open: a stay ending on the 5th does not clash with one starting then.
        lt(bookings.checkIn, input.checkOut),
        gt(bookings.checkOut, input.checkIn),
      ),
    )
    .orderBy(asc(bookings.checkIn));

  const incomingName = normaliseName(input.guestName);

  return rows
    .filter((booking) => booking.id !== input.excludeId)
    .map((booking) => ({
      kind:
        booking.checkIn === input.checkIn &&
        booking.checkOut === input.checkOut &&
        incomingName !== "" &&
        normaliseName(booking.guestName) === incomingName
          ? ("duplicate" as ClashKind)
          : ("overlap" as ClashKind),
      booking,
    }));
}

/**
 * Folds an incoming row into a booking that already exists — "merge complete".
 *
 * Only fills gaps: COALESCE means anything already recorded wins, so a figure
 * typed in by hand is never overwritten by a spreadsheet. Dates are left alone
 * (they matched, or this would not be a duplicate) and so is the reference,
 * which may already have been sent to the guest.
 */
export async function mergeIntoBooking(
  id: string,
  input: BookingInput,
): Promise<Booking | null> {
  const [updated] = await db
    .update(bookings)
    .set({
      guestName: sql`coalesce(${bookings.guestName}, ${input.guestName ?? null})`,
      guestPhone: sql`coalesce(${bookings.guestPhone}, ${input.guestPhone ?? null})`,
      guests: sql`coalesce(${bookings.guests}, ${input.guests ?? null})`,
      externalRef: sql`coalesce(${bookings.externalRef}, ${input.externalRef ?? null})`,
      grossPaise: sql`coalesce(${bookings.grossPaise}, ${input.grossPaise ?? null})`,
      commissionPaise: sql`coalesce(${bookings.commissionPaise}, ${input.commissionPaise ?? null})`,
      receivedPaise: sql`coalesce(${bookings.receivedPaise}, ${input.receivedPaise ?? null})`,
      note: sql`coalesce(${bookings.note}, ${input.note ?? null})`,
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, id))
    .returning();

  return updated ?? null;
}

/**
 * Used by the email importer: creates the booking, or updates the existing one
 * for the same (source, reference) without ever overwriting money the owner
 * has already entered by hand.
 */
export async function upsertImportedBooking(
  input: BookingInput & { externalRef: string },
): Promise<Booking> {
  const [saved] = await db
    .insert(bookings)
    .values({
      ...input,
      reference: input.reference ?? buildReference(input.checkIn),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [bookings.source, bookings.externalRef],
      set: {
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        status: input.status ?? "confirmed",
        // Only fill these when they are still empty — COALESCE keeps whatever
        // the owner typed, since the channel emails are not a money source.
        guestName: sql`coalesce(${bookings.guestName}, ${input.guestName ?? null})`,
        guestPhone: sql`coalesce(${bookings.guestPhone}, ${input.guestPhone ?? null})`,
        updatedAt: new Date(),
      },
    })
    .returning();

  return saved!;
}

export async function updateBooking(
  id: string,
  patch: Partial<BookingInput>,
): Promise<Booking | null> {
  const [updated] = await db
    .update(bookings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(bookings.id, id))
    .returning();

  return updated ?? null;
}

export async function deleteBooking(id: string): Promise<boolean> {
  const deleted = await db
    .delete(bookings)
    .where(eq(bookings.id, id))
    .returning({ id: bookings.id });

  return deleted.length > 0;
}

export async function listExpenses(range?: {
  from?: string;
  to?: string;
}): Promise<Expense[]> {
  const filters = [];
  if (range?.from) filters.push(gte(expenses.spentOn, range.from));
  if (range?.to) filters.push(lte(expenses.spentOn, range.to));

  return db
    .select()
    .from(expenses)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(expenses.spentOn));
}

export async function createExpense(input: {
  spentOn: string;
  amountPaise: number;
  category: Expense["category"];
  note?: string | null;
}): Promise<Expense> {
  const [created] = await db.insert(expenses).values(input).returning();
  return created!;
}

export async function deleteExpense(id: string): Promise<boolean> {
  const deleted = await db
    .delete(expenses)
    .where(eq(expenses.id, id))
    .returning({ id: expenses.id });

  return deleted.length > 0;
}

export async function listPayouts(): Promise<Payout[]> {
  return db.select().from(payouts).orderBy(desc(payouts.paidOn));
}

export async function recordPayout(input: {
  source: BookingSource;
  amountPaise: number;
  paidOn: string;
  reference?: string | null;
  note?: string | null;
}): Promise<void> {
  await db.insert(payouts).values(input).onConflictDoNothing();
}

export type MonthlySummary = {
  month: string;
  grossPaise: number;
  commissionPaise: number;
  taxPaise: number;
  receivedPaise: number;
  expensePaise: number;
  netPaise: number;
  nights: number;
  bookingCount: number;
};

export type LedgerSummary = {
  months: MonthlySummary[];
  bySource: Array<{
    source: BookingSource;
    grossPaise: number;
    bookingCount: number;
    nights: number;
  }>;
  totals: {
    grossPaise: number;
    commissionPaise: number;
    taxPaise: number;
    expensePaise: number;
    netPaise: number;
    bookingCount: number;
    awaitingAmount: number;
  };
};

const monthOf = (isoDate: string) => isoDate.slice(0, 7);

function nightsBetween(checkIn: string, checkOut: string): number {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 86_400_000);
}

/**
 * Rolls bookings and expenses into per-month and per-channel figures.
 *
 * Cancelled bookings are excluded from revenue entirely — they represent money
 * that never arrived, and counting them would flatter every total. Bookings
 * with no amount entered yet contribute nothing but are counted in
 * `awaitingAmount` so the dashboard can prompt for them.
 */
export async function getLedgerSummary(): Promise<LedgerSummary> {
  const [allBookings, allExpenses] = await Promise.all([
    listBookings(),
    listExpenses(),
  ]);

  const months = new Map<string, MonthlySummary>();
  const bySource = new Map<BookingSource, LedgerSummary["bySource"][number]>();

  const emptyMonth = (month: string): MonthlySummary => ({
    month,
    grossPaise: 0,
    commissionPaise: 0,
    taxPaise: 0,
    receivedPaise: 0,
    expensePaise: 0,
    netPaise: 0,
    nights: 0,
    bookingCount: 0,
  });

  const totals = {
    grossPaise: 0,
    commissionPaise: 0,
    taxPaise: 0,
    expensePaise: 0,
    netPaise: 0,
    bookingCount: 0,
    awaitingAmount: 0,
  };

  for (const booking of allBookings) {
    if (booking.status === "cancelled") continue;

    const month = monthOf(booking.checkIn);
    const entry = months.get(month) ?? emptyMonth(month);
    const nights = nightsBetween(booking.checkIn, booking.checkOut);

    const gross = booking.grossPaise ?? 0;
    const commission = booking.commissionPaise ?? 0;
    const tax = booking.taxPaise ?? 0;

    entry.grossPaise += gross;
    entry.commissionPaise += commission;
    entry.taxPaise += tax;
    entry.receivedPaise += booking.receivedPaise ?? 0;
    entry.nights += nights;
    entry.bookingCount += 1;
    months.set(month, entry);

    const source = bySource.get(booking.source) ?? {
      source: booking.source,
      grossPaise: 0,
      bookingCount: 0,
      nights: 0,
    };
    source.grossPaise += gross;
    source.bookingCount += 1;
    source.nights += nights;
    bySource.set(booking.source, source);

    totals.grossPaise += gross;
    totals.commissionPaise += commission;
    totals.taxPaise += tax;
    totals.bookingCount += 1;
    if (booking.grossPaise === null) totals.awaitingAmount += 1;
  }

  for (const expense of allExpenses) {
    const month = monthOf(expense.spentOn);
    const entry = months.get(month) ?? emptyMonth(month);
    entry.expensePaise += expense.amountPaise;
    months.set(month, entry);
    totals.expensePaise += expense.amountPaise;
  }

  for (const entry of months.values()) {
    entry.netPaise =
      entry.grossPaise -
      entry.commissionPaise -
      entry.taxPaise -
      entry.expensePaise;
  }

  totals.netPaise =
    totals.grossPaise -
    totals.commissionPaise -
    totals.taxPaise -
    totals.expensePaise;

  return {
    months: [...months.values()].sort((left, right) =>
      right.month.localeCompare(left.month),
    ),
    bySource: [...bySource.values()].sort(
      (left, right) => right.grossPaise - left.grossPaise,
    ),
    totals,
  };
}
