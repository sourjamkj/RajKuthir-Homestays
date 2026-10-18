import type { DateRange } from "./availability.ts";
import { buildReference } from "./booking-reference.ts";
import {
  clashesWith,
  hashPayToken,
  holdExpiry,
  newPayToken,
  nextFreeWindows,
  type BookPaySettings,
} from "./book-pay-rules.ts";
import type { QuoteResult } from "./enquiry-quote.ts";

/**
 * Starting a self-serve hold: the one step where two guests can race.
 *
 * The store is injected so the race itself is testable without a database.
 * In production `withLock` is a Postgres transaction holding an advisory
 * lock (book-pay-repo.ts), so two /book/start calls for overlapping dates
 * run one after the other: the second re-reads the taken dates INSIDE the
 * lock, sees the first guest's hold, and is refused.
 */

export type StartInput = {
  name: string;
  phone: string;
  email: string | null;
  requests: string | null;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  pets: number;
};

export type HoldRecord = {
  input: StartInput;
  reference: string;
  tokenHash: string;
  totalPaise: number;
  advancePaise: number;
  advancePercent: number;
  quoteSentAt: Date;
  holdExpiresAt: Date;
};

export type StartStore<Tx> = {
  withLock<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
  /** Every range a new guest cannot have: bookings, OTA/manual blocks, live holds. */
  takenRanges(tx: Tx, now: Date): Promise<DateRange[]>;
  /** Creates the enquiry (with its quote) and the payment request together. */
  createHold(tx: Tx, record: HoldRecord): Promise<{ enquiryId: string; paymentRequestId: string }>;
};

export type StartResult =
  | {
      ok: true;
      token: string;
      reference: string;
      enquiryId: string;
      paymentRequestId: string;
      holdExpiresAt: Date;
      totalPaise: number;
      advancePaise: number;
    }
  | { ok: false; status: 409; error: string; nextFree: DateRange[] }
  | { ok: false; status: 422; error: string };

export async function startHold<Tx>(
  store: StartStore<Tx>,
  input: StartInput,
  quote: QuoteResult,
  settings: BookPaySettings,
  now: Date,
  today: string,
): Promise<StartResult> {
  // Priced by the server, from the dates and party alone. Nothing the
  // browser said about money is read anywhere on this path.
  if (!quote.ok) return { ok: false, status: 422, error: quote.reason };

  const stay = { startDate: input.checkIn, endDate: input.checkOut };

  return store.withLock(async (tx) => {
    const taken = await store.takenRanges(tx, now);
    const clash = clashesWith(stay, taken);

    if (clash) {
      return {
        ok: false as const,
        status: 409 as const,
        error: "Those dates were just taken. Here are the next free dates for the same length of stay.",
        nextFree: nextFreeWindows(stay, taken, { today }),
      };
    }

    const token = newPayToken();
    const record: HoldRecord = {
      input,
      reference: buildReference(input.checkIn),
      tokenHash: hashPayToken(token),
      totalPaise: quote.totalPaise,
      advancePaise: quote.advancePaise,
      advancePercent: settings.advancePercent,
      quoteSentAt: now,
      holdExpiresAt: holdExpiry(now, settings),
    };

    const created = await store.createHold(tx, record);

    return {
      ok: true as const,
      token,
      reference: record.reference,
      enquiryId: created.enquiryId,
      paymentRequestId: created.paymentRequestId,
      holdExpiresAt: record.holdExpiresAt,
      totalPaise: record.totalPaise,
      advancePaise: record.advancePaise,
    };
  });
}
