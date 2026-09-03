/**
 * Spreadsheet → bookings.
 *
 * This module is deliberately pure: it takes a header row and data rows as
 * plain arrays and returns validated bookings plus per-row errors. Reading the
 * .xlsx file into those arrays happens elsewhere, so the part that actually
 * decides what enters the database can be tested without a file.
 *
 * Nothing here throws on bad input. A spreadsheet filled in by hand will have
 * mistakes, and the owner needs to see every one of them at once rather than
 * fixing them one failed upload at a time.
 */

export type ImportSourceValue =
  | "manual"
  | "direct"
  | "bookingCom"
  | "airbnb"
  | "makeMyTrip";

export type ImportStatusValue = "pending" | "confirmed" | "cancelled";

export type ParsedBooking = {
  source: ImportSourceValue;
  guestName: string | null;
  guestPhone: string | null;
  checkIn: string;
  checkOut: string;
  guests: number | null;
  status: ImportStatusValue;
  grossPaise: number | null;
  commissionPaise: number | null;
  receivedPaise: number | null;
  note: string | null;
};

export type ParsedRow = {
  /** 1-based row number as it appears in the spreadsheet, header included. */
  rowNumber: number;
  booking: ParsedBooking | null;
  errors: string[];
  nights: number;
};

export type ParseResult = {
  rows: ParsedRow[];
  /** Header cells we did not recognise — surfaced so typos are visible. */
  unknownColumns: string[];
  /** Required columns the sheet is missing entirely. */
  missingColumns: string[];
  validCount: number;
  errorCount: number;
};

type FieldKey =
  | "checkIn"
  | "checkOut"
  | "guestName"
  | "guestPhone"
  | "guests"
  | "gross"
  | "commission"
  | "received"
  | "source"
  | "status"
  | "note";

/**
 * Header synonyms. People write "Check In", "check-in", "Arrival" and
 * "From" for the same thing; rejecting a sheet over that is needless friction.
 */
const COLUMN_ALIASES: Record<FieldKey, string[]> = {
  checkIn: ["checkin", "check in", "check-in", "arrival", "from", "start date", "start"],
  checkOut: ["checkout", "check out", "check-out", "departure", "to", "end date", "end"],
  guestName: ["guest", "guest name", "name", "customer", "guestname"],
  guestPhone: ["phone", "mobile", "contact", "phone number", "contact number"],
  guests: ["guests", "pax", "occupancy", "no of guests", "number of guests", "persons", "people"],
  gross: ["amount", "total", "total amount", "gross", "rate", "price", "booking amount"],
  commission: ["commission", "channel commission", "otacommission", "ota commission"],
  received: ["received", "paid", "advance", "amount received", "payment received"],
  source: ["channel", "source", "platform", "booked via", "booking source"],
  status: ["status", "booking status"],
  note: ["note", "notes", "remark", "remarks", "comment", "comments"],
};

const REQUIRED: FieldKey[] = ["checkIn", "checkOut"];

const SOURCE_ALIASES: Record<string, ImportSourceValue> = {
  manual: "manual",
  offline: "manual",
  walkin: "manual",
  "walk in": "manual",
  "walk-in": "manual",
  direct: "direct",
  "direct booking": "direct",
  whatsapp: "direct",
  phone: "direct",
  referral: "direct",
  booking: "bookingCom",
  "booking.com": "bookingCom",
  bookingcom: "bookingCom",
  bdc: "bookingCom",
  airbnb: "airbnb",
  abnb: "airbnb",
  makemytrip: "makeMyTrip",
  mmt: "makeMyTrip",
  goibibo: "makeMyTrip",
};

const STATUS_ALIASES: Record<string, ImportStatusValue> = {
  confirmed: "confirmed",
  confirm: "confirmed",
  done: "confirmed",
  completed: "confirmed",
  stayed: "confirmed",
  pending: "pending",
  tentative: "pending",
  enquiry: "pending",
  cancelled: "cancelled",
  canceled: "cancelled",
  cancel: "cancelled",
  "no show": "cancelled",
  noshow: "cancelled",
};

const normalise = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_.]+/g, " ")
    .replace(/\s+/g, " ");

function mapHeaders(header: unknown[]): {
  columns: Partial<Record<FieldKey, number>>;
  unknownColumns: string[];
} {
  const columns: Partial<Record<FieldKey, number>> = {};
  const unknownColumns: string[] = [];

  header.forEach((cell, index) => {
    const label = normalise(cell);
    if (!label) return;

    const match = (Object.keys(COLUMN_ALIASES) as FieldKey[]).find((key) =>
      COLUMN_ALIASES[key].includes(label),
    );

    // First column wins, so a duplicate header cannot silently shadow the real one.
    if (match && columns[match] === undefined) {
      columns[match] = index;
    } else if (!match) {
      unknownColumns.push(String(cell).trim());
    }
  });

  return { columns, unknownColumns };
}

/**
 * Accepts what spreadsheets actually contain: a real Date (how Excel stores
 * dates), an ISO string, or day-first text like 02/10/2026 — day-first because
 * that is the Indian convention and the sheets are filled in locally.
 */
export function parseDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Excel dates arrive as UTC midnight; read them back the same way so the
    // day never shifts under a negative-offset server clock.
    return value.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dayFirst = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = Number(dayFirst[2]);
    let year = Number(dayFirst[3]);
    if (year < 100) year += 2000;

    if (day < 1 || day > 31 || month < 1 || month > 12) return null;

    const candidate = new Date(Date.UTC(year, month - 1, day));
    // Rejects 31 February rather than letting it roll into March.
    if (
      candidate.getUTCFullYear() !== year ||
      candidate.getUTCMonth() !== month - 1 ||
      candidate.getUTCDate() !== day
    ) {
      return null;
    }

    return candidate.toISOString().slice(0, 10);
  }

  return null;
}

/** Money as typed by a person: "3,500", "₹3500", "3500.50", or blank. */
export function parseMoneyPaise(value: unknown): number | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;

  const cleaned = String(value)
    .replace(/[₹,\s]/g, "")
    .trim();

  if (!cleaned) return null;

  const rupees = Number(cleaned);
  if (!Number.isFinite(rupees) || rupees < 0 || rupees > 100_000_000) {
    return "invalid";
  }

  return Math.round(rupees * 100);
}

function parseCount(value: unknown): number | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) return "invalid";

  return parsed;
}

function text(value: unknown, max: number): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw.slice(0, max) : null;
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 86_400_000);
}

export function parseBookingSheet(rows: unknown[][]): ParseResult {
  const nonEmpty = rows.filter((row) =>
    row.some((cell) => String(cell ?? "").trim() !== ""),
  );

  if (nonEmpty.length === 0) {
    return {
      rows: [],
      unknownColumns: [],
      missingColumns: REQUIRED.map(String),
      validCount: 0,
      errorCount: 0,
    };
  }

  const [header, ...dataRows] = nonEmpty;
  const { columns, unknownColumns } = mapHeaders(header ?? []);

  const missingColumns = REQUIRED.filter(
    (key) => columns[key] === undefined,
  ).map((key) => (key === "checkIn" ? "Check-in" : "Check-out"));

  if (missingColumns.length > 0) {
    return {
      rows: [],
      unknownColumns,
      missingColumns,
      validCount: 0,
      errorCount: 0,
    };
  }

  const cellAt = (row: unknown[], key: FieldKey): unknown => {
    const index = columns[key];
    return index === undefined ? undefined : row[index];
  };

  const parsed: ParsedRow[] = dataRows.map((row, offset) => {
    // +2: one for the header row, one because spreadsheets are 1-based.
    const rowNumber = offset + 2;
    const errors: string[] = [];

    const checkIn = parseDate(cellAt(row, "checkIn"));
    const checkOut = parseDate(cellAt(row, "checkOut"));

    if (!checkIn) errors.push("Check-in date is missing or unreadable");
    if (!checkOut) errors.push("Check-out date is missing or unreadable");
    if (checkIn && checkOut && checkOut <= checkIn) {
      errors.push("Check-out must be after check-in");
    }

    const gross = parseMoneyPaise(cellAt(row, "gross"));
    if (gross === "invalid") errors.push("Amount is not a valid number");

    const commission = parseMoneyPaise(cellAt(row, "commission"));
    if (commission === "invalid") errors.push("Commission is not a valid number");

    const received = parseMoneyPaise(cellAt(row, "received"));
    if (received === "invalid") errors.push("Received is not a valid number");

    const guests = parseCount(cellAt(row, "guests"));
    if (guests === "invalid") errors.push("Guests must be a whole number");

    const rawSource = normalise(cellAt(row, "source"));
    // Blank channel means offline — that is the whole point of this import.
    const source: ImportSourceValue = rawSource
      ? (SOURCE_ALIASES[rawSource] ?? "manual")
      : "manual";

    if (rawSource && !SOURCE_ALIASES[rawSource]) {
      errors.push(`Channel "${rawSource}" not recognised — treated as offline`);
    }

    const rawStatus = normalise(cellAt(row, "status"));
    const status: ImportStatusValue = rawStatus
      ? (STATUS_ALIASES[rawStatus] ?? "confirmed")
      : "confirmed";

    if (rawStatus && !STATUS_ALIASES[rawStatus]) {
      errors.push(`Status "${rawStatus}" not recognised — treated as confirmed`);
    }

    // A row with an unrecognised channel or status is still importable — those
    // are warnings with a stated fallback, not blockers. Only dates are fatal.
    const fatal = !checkIn || !checkOut || (checkOut <= checkIn);
    const unusable =
      fatal ||
      gross === "invalid" ||
      commission === "invalid" ||
      received === "invalid" ||
      guests === "invalid";

    return {
      rowNumber,
      errors,
      nights: checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0,
      booking: unusable
        ? null
        : {
            source,
            status,
            checkIn: checkIn!,
            checkOut: checkOut!,
            guestName: text(cellAt(row, "guestName"), 200),
            guestPhone: text(cellAt(row, "guestPhone"), 40),
            // In this branch `unusable` is false, which already ruled out
            // "invalid" for each of these — so they are `number | null` here.
            guests,
            grossPaise: gross,
            commissionPaise: commission,
            receivedPaise: received,
            note: text(cellAt(row, "note"), 500),
          },
    };
  });

  return {
    rows: parsed,
    unknownColumns,
    missingColumns: [],
    validCount: parsed.filter((row) => row.booking !== null).length,
    errorCount: parsed.filter((row) => row.booking === null).length,
  };
}
