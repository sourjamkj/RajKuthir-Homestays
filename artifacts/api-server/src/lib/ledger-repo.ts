import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  db,
  bookings,
  expenses,
  payouts,
  type Booking,
  type Expense,
  type Payout,
} from "@workspace/db";

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

export async function createBooking(input: BookingInput): Promise<Booking> {
  const [created] = await db
    .insert(bookings)
    .values({ ...input, updatedAt: new Date() })
    .returning();

  return created!;
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
    .values({ ...input, updatedAt: new Date() })
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
