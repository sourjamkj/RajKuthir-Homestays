import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { BUSINESS, money } from "./invoice-rules.ts";
import { pdfSafe } from "./invoice-pdf.ts";
import {
  CHILD_UNDER_AGE,
  EXTRA_ADULT_PAISE,
  EXTRA_CHILD_PAISE,
  RATE_CARD_MAX_GUESTS,
  SECURITY_DEPOSIT_PAISE,
  petChargeNote,
} from "./party.ts";

/**
 * The notice board the West Bengal Homestay Policy asks every registered
 * homestay to put up where guests can see it: name and registration,
 * timings, guidelines, what is prohibited, the tariff, emergency numbers,
 * the nearest police station and health facility, and who to complain to.
 *
 * Every price is read from the live rate plan and party.ts — nothing typed
 * here — so the board on the wall matches what the site charges on the day
 * it is printed. Lines the site cannot know (the registration number until
 * the certificate arrives, a police station not yet in the arrival pack)
 * print as blanks to write in by hand rather than as a guess.
 */

export type BoardContact = { label: string; name: string; phone: string };

export type BoardInput = {
  /** Weekday (Sun–Thu) and weekend (Fri–Sat) rate per occupancy, in paise. */
  rates: Record<number, number>;
  weekendRates: Record<number, number>;
  /** Festival periods with their own pricing and minimum stay. */
  peaks: Array<{ label: string; minNights: number }>;
  /** From the arrival pack (owner-edited); matched by label. */
  contacts: BoardContact[];
  registrationNumber?: string | null;
  printedOn: Date;
};

const GREEN = rgb(0x2d / 255, 0x66 / 255, 0x58 / 255);
const INK = rgb(0.13, 0.15, 0.14);
const MUTED = rgb(0.42, 0.45, 0.43);
const RULE = rgb(0.85, 0.83, 0.78);
const RED = rgb(0.62, 0.16, 0.12);

/** Cafe Soi's hours, as the owner gave them. Same as CAFE_HOURS in raj-kuthir content/cafe-menu.ts. */
export const CAFE_HOURS = "10 am to 9 pm";

export const EMERGENCY_NUMBERS: Array<[string, string]> = [
  ["Emergency (all services)", "112"],
  ["Police", "100"],
  ["Fire", "101"],
  ["Ambulance", "108"],
  ["Women helpline", "1091"],
];

/** The arrival-pack contact whose label mentions any of these words, if there is one. */
export function contactFor(contacts: BoardContact[], words: RegExp): BoardContact | null {
  return contacts.find((c) => words.test(c.label) || words.test(c.name)) ?? null;
}

const POLICE = /police|thana/i;
const HEALTH = /hospital|health|clinic|doctor|medical|nursing/i;

export function boardSections(input: BoardInput): Array<{ title: string; lines: string[]; tone?: "warn" }> {
  const police = contactFor(input.contacts, POLICE);
  const health = contactFor(input.contacts, HEALTH);
  const blank = "________________________________";
  const tariff: string[] = [];
  for (let guests = 1; guests <= RATE_CARD_MAX_GUESTS; guests += 1) {
    const weekday = input.rates[guests];
    const weekend = input.weekendRates[guests];
    if (weekday === undefined || weekend === undefined) continue;
    tariff.push(`${guests} guest${guests === 1 ? "" : "s"}:  Sun-Thu ${money(weekday)}  ·  Fri-Sat ${money(weekend)}  per night, whole villa`);
  }
  tariff.push(
    `Above ${RATE_CARD_MAX_GUESTS} guests: ${money(EXTRA_ADULT_PAISE)} per extra adult, ${money(EXTRA_CHILD_PAISE)} per child under ${CHILD_UNDER_AGE}, per night (extra bedding included).`,
    petChargeNote(),
    `Refundable security deposit: ${money(SECURITY_DEPOSIT_PAISE)}, paid at check-in, returned at check-out.`,
    "Not registered under GST: no GST is charged on direct bookings.",
  );
  if (input.peaks.length) {
    const names = [...new Set(input.peaks.map((p) => p.label))].join(", ");
    tariff.push(`Festival dates (${names}) have their own rates and minimum stay. Exact price for any dates: ${BUSINESS.website}/rates`);
  }

  return [
    {
      title: "Timings",
      lines: [
        "Check-in from 12:00 noon  ·  Check-out by 11:00 am",
        `Dining: guest kitchen for your own cooking; Cafe Soi on the grounds, open ${CAFE_HOURS}.`,
        "Please keep the volume down after 10:00 pm.",
      ],
    },
    { title: "Tariff", lines: tariff },
    {
      title: "Guest guidelines",
      lines: [
        "A valid photo ID is required for every adult staying. Foreign guests: passport and visa (Form C is filed as the law requires).",
        "Only the guests named on the booking may stay overnight. Tell us before bringing anyone extra.",
        "Pets are welcome; please keep them off beds, sofas and linen.",
        "Leave the house as you found it. Damage or soiling is charged as per the house rules.",
      ],
    },
    {
      title: "Not allowed on the premises",
      tone: "warn",
      lines: [
        "Smoking indoors (ashtrays are in the patio and garden)  ·  Prohibited or illegal substances",
        "Loud music or noise after 10:00 pm  ·  Any illegal activity",
        "NO PLASTIC: please avoid single-use plastic and use the bins provided.",
      ],
    },
    {
      title: "Emergency numbers",
      lines: [
        EMERGENCY_NUMBERS.map(([label, number]) => `${label}: ${number}`).join("   ·   "),
        `Nearest police station: ${police ? `${police.name || police.label}, ${police.phone}` : blank}`,
        `Nearest health facility: ${health ? `${health.name || health.label}, ${health.phone}` : blank}`,
      ],
    },
    {
      title: "Complaints, suggestions and grievances",
      lines: [
        `Host: Sourja Mukherjee, ${BUSINESS.phone} (call or WhatsApp)`,
        `Complaints & suggestions book: ${BUSINESS.website}/feedback (scan the code), or ask the host for the book.`,
      ],
    },
  ];
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of pdfSafe(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderDisplayBoardPdf(input: BoardInput, feedbackQrPng?: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${BUSINESS.name} – guest notice board`);
  pdf.setCreator(BUSINESS.website);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const width = 595;
  const height = 842;
  const left = 44;
  const right = width - 44;
  let page: PDFPage = pdf.addPage([width, height]);
  let y = height - 52;

  const text = (value: string, x: number, size: number, font: PDFFont, color = INK) =>
    page.drawText(pdfSafe(value), { x, y, size, font, color });

  // Header: name, address, registration lines.
  page.drawRectangle({ x: 0, y: height - 14, width, height: 14, color: GREEN });
  text(BUSINESS.name, left, 20, bold, GREEN);
  y -= 18;
  text(BUSINESS.address.join(", "), left, 9.5, regular, MUTED);
  y -= 20;
  const registration = input.registrationNumber?.trim() || "______________________";
  text(`WB Homestay registration no.: ${registration}`, left, 10.5, bold);
  y -= 14;
  text(`MSME Udyam: ${BUSINESS.udyam}`, left, 10.5, regular);
  y -= 12;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: RULE });
  y -= 22;

  const qrSize = 92;
  const sections = boardSections(input);
  for (const section of sections) {
    const isLast = section === sections[sections.length - 1];
    const lineWidth = right - left - (isLast && feedbackQrPng ? qrSize + 14 : 0);
    const wrapped = section.lines.map((line) => wrap(line, regular, 10, lineWidth));
    const needed = 18 + wrapped.reduce((sum, lines) => sum + lines.length * 13 + 3, 0) + 10;
    if (y - needed < 40) {
      page = pdf.addPage([width, height]);
      y = height - 52;
    }
    text(section.title.toUpperCase(), left, 10.5, bold, section.tone === "warn" ? RED : GREEN);
    const sectionTop = y;
    y -= 16;
    for (const lines of wrapped) {
      lines.forEach((line, index) => {
        page.drawText(index === 0 ? `•  ${line}` : `    ${line}`, { x: left, y, size: 10, font: regular, color: INK });
        y -= 13;
      });
      y -= 3;
    }
    if (isLast && feedbackQrPng) {
      const image = await pdf.embedPng(feedbackQrPng);
      page.drawImage(image, { x: right - qrSize, y: Math.min(sectionTop - qrSize + 6, y), width: qrSize, height: qrSize });
      y = Math.min(y, sectionTop - qrSize);
    }
    y -= 10;
  }

  page.drawText(pdfSafe(`Printed ${input.printedOn.toISOString().slice(0, 10)} from ${BUSINESS.website}. Prices are those on the day of printing.`), {
    x: left,
    y: 26,
    size: 7.5,
    font: regular,
    color: MUTED,
  });

  return pdf.save();
}
