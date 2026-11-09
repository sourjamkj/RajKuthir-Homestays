/**
 * What the West Bengal Homestay Policy asks the house to keep, and how it is
 * worded: the guest register, the Form C reminder for foreign guests, and
 * the complaints & suggestions book.
 *
 * Pure functions only, so they are tested with `node --test` like the other
 * *-rules files. compliance-repo.ts does the querying.
 */

import { CHECK_IN_LOCAL } from "./guest-verification-rules.ts";

const HOUR_MS = 60 * 60 * 1000;

/** Form C is filed on the FRRO portal within 24 hours of a foreign guest's arrival. */
export const FORM_C_WITHIN_HOURS = 24;
export const FORM_C_PORTAL_URL = "https://indianfrro.gov.in/frro/FormC";

const INDIA_NAMES = new Set(["india", "in", "ind", "bharat", "republic of india", "indian"]);

/**
 * Whether the nationality a guest typed is somewhere other than India.
 * Null when they left it blank: the register then says "not given" rather
 * than guessing either way.
 */
export function isForeignNationality(country: string | null | undefined): boolean | null {
  const value = (country ?? "").trim().toLowerCase().replace(/[.\s]+/g, " ").trim();
  if (!value) return null;
  return !INDIA_NAMES.has(value);
}

/** Check-in time on the check-in date, as an instant. */
export function arrivalAt(checkIn: string): Date {
  return new Date(`${checkIn}T${CHECK_IN_LOCAL}`);
}

export function formCDueAt(checkIn: string): Date {
  return new Date(arrivalAt(checkIn).getTime() + FORM_C_WITHIN_HOURS * HOUR_MS);
}

export type FormCState = "not_needed" | "unknown" | "filed" | "upcoming" | "due" | "overdue";

/**
 * Where a stay stands on Form C.
 *
 * "due" opens at arrival (the form needs the guest's arrival details) and
 * closes 24 hours later; after that it is "overdue" until it is marked
 * filed. Stays more than a week before arrival are "upcoming".
 */
export function formCState(input: {
  country: string | null | undefined;
  checkIn: string;
  filedAt: Date | null | undefined;
  now: Date;
}): FormCState {
  const foreign = isForeignNationality(input.country);
  if (foreign === false) return "not_needed";
  if (input.filedAt) return "filed";
  if (foreign === null) return "unknown";
  const arrival = arrivalAt(input.checkIn).getTime();
  const now = input.now.getTime();
  if (now < arrival) return "upcoming";
  if (now <= formCDueAt(input.checkIn).getTime()) return "due";
  return "overdue";
}

export const FORM_C_LABEL: Record<FormCState, string> = {
  not_needed: "Not needed (Indian)",
  unknown: "Nationality not given",
  filed: "Filed",
  upcoming: "Due within 24h of arrival",
  due: "Due now",
  overdue: "Overdue",
};

// ---------------------------------------------------------------------------
// Guest register
// ---------------------------------------------------------------------------

export type RegisterRow = {
  bookingId: string;
  reference: string | null;
  source: string;
  status: string;
  checkIn: string;
  checkOut: string;
  bookingName: string | null;
  bookingPhone: string | null;
  guests: number | null;
  pets: number | null;
  guestName: string | null;
  guestPhone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  documentTypes: string[];
  formCFiledAt: Date | null;
  formCReference: string | null;
};

const SOURCE_LABEL: Record<string, string> = {
  direct: "Direct",
  manual: "Direct (offline)",
  bookingCom: "Booking.com",
  airbnb: "Airbnb",
  makeMyTrip: "MakeMyTrip",
};

export const REGISTER_HEADER = [
  "Sl no",
  "Booking ref",
  "Check-in",
  "Check-out",
  "Nights",
  "Guest name",
  "Phone",
  "Address",
  "Nationality",
  "Guests",
  "Pets",
  "ID documents",
  "Form C",
  "Booked via",
];

export function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / (24 * HOUR_MS))) : 0;
}

/** dd-mm-yyyy, the way a paper register is written. */
export function registerDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}-${m}-${y}` : iso;
}

function formCCell(row: RegisterRow, now: Date): string {
  const state = formCState({ country: row.country, checkIn: row.checkIn, filedAt: row.formCFiledAt, now });
  if (state === "filed") return row.formCReference ? `Filed (${row.formCReference})` : "Filed";
  return FORM_C_LABEL[state];
}

/** The register's rows as cells, oldest arrival first; cancelled stays left out. */
export function registerCells(rows: RegisterRow[], now: Date): string[][] {
  return rows
    .filter((row) => row.status !== "cancelled")
    .sort((a, b) => (a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : 0))
    .map((row, index) => [
      String(index + 1),
      row.reference ?? "",
      registerDate(row.checkIn),
      registerDate(row.checkOut),
      String(nightsBetween(row.checkIn, row.checkOut)),
      row.guestName ?? row.bookingName ?? "",
      row.guestPhone ?? row.bookingPhone ?? "",
      [row.address, row.city, row.state].map((part) => part?.trim()).filter(Boolean).join(", "),
      row.country?.trim() || "",
      row.guests === null ? "" : String(row.guests),
      row.pets ? String(row.pets) : "0",
      row.documentTypes.length ? [...new Set(row.documentTypes)].join("; ") : "Not uploaded",
      formCCell(row, now),
      SOURCE_LABEL[row.source] ?? row.source,
    ]);
}

/**
 * One CSV cell. Quoted when it must be, and a leading = @ or a sign that is
 * not the start of a number is defused with an apostrophe, so a name typed as
 * a formula cannot run when the register is opened in a spreadsheet. Phone
 * numbers (+91 …) are left alone.
 */
export function csvCell(value: string): string {
  let text = value.replace(/\r\n?/g, "\n");
  if (/^[=@\t\r]/.test(text) || /^[+-](?![\d\s])/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: string[][]): string {
  // The BOM makes Excel read the file as UTF-8, so a Bengali name survives.
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** A from/to date pair from a query string; both optional, both checked. */
export function readPeriod(from: unknown, to: unknown): { from: string | null; to: string | null } | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const f = typeof from === "string" && from ? from : null;
  const t = typeof to === "string" && to ? to : null;
  if ((f && !iso.test(f)) || (t && !iso.test(t))) return null;
  if (f && t && f > t) return null;
  return { from: f, to: t };
}

// ---------------------------------------------------------------------------
// Complaints & suggestions book
// ---------------------------------------------------------------------------

export const FEEDBACK_KINDS = ["complaint", "suggestion", "compliment"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export type FeedbackInput = {
  kind: FeedbackKind;
  name: string;
  contact: string | null;
  stayRef: string | null;
  message: string;
};

const clip = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

/**
 * Checks what the public form posted. `website` is the honeypot: people never
 * see that field, so anything in it means a bot, and the caller pretends to
 * accept it without storing it.
 */
export function readFeedback(
  body: unknown,
): { ok: true; value: FeedbackInput } | { ok: false; reason: string } | { ok: "bot" } {
  const source = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (clip(source.website, 200)) return { ok: "bot" };
  const kind = FEEDBACK_KINDS.find((k) => k === source.kind);
  if (!kind) return { ok: false, reason: "Choose complaint, suggestion or compliment." };
  const name = clip(source.name, 80);
  if (name.length < 2) return { ok: false, reason: "Please add your name." };
  const message = typeof source.message === "string" ? source.message.trim().slice(0, 4000) : "";
  if (message.length < 10) return { ok: false, reason: "Please write a few words, at least 10 characters." };
  return {
    ok: true,
    value: {
      kind,
      name,
      contact: clip(source.contact, 120) || null,
      stayRef: clip(source.stayRef, 40) || null,
      message,
    },
  };
}
