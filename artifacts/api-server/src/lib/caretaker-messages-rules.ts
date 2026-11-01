/**
 * Messages from the owner to the caretaker: salary credited, a festival bonus,
 * a day off, or a notice about the house. Pure rules; the history table is in
 * caretaker-messages.ts.
 *
 * Each message is written the same way, so they read as coming from a
 * business: the property's name in bold at the top, a greeting by name, one
 * clear sentence with the key facts in bold, and a signed close. WhatsApp
 * formatting only (*bold*, • lists, blank lines between parts).
 *
 * No amounts. The caretaker's messages never carry money figures (a standing
 * rule for everything she receives); a salary note says it has been paid and
 * how, not how much.
 *
 * Sending: the owner presses Send and the message opens in their own WhatsApp
 * on the caretaker's chat. Nothing here sends automatically.
 */

export const PROPERTY_LINE = "*Raj Kuthir Homestays – Sobuj Potro*";

export const CARETAKER_MESSAGE_KINDS = ["salary_credited", "bonus_credited", "day_off", "notice"] as const;
export type CaretakerMessageKind = (typeof CARETAKER_MESSAGE_KINDS)[number];

export const PAYMENT_METHODS = ["UPI", "bank transfer", "cash"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type FieldSpec = {
  key: string;
  label: string;
  type: "month" | "date" | "choice" | "text" | "longtext";
  required: boolean;
  options?: readonly string[];
  max?: number;
  hint?: string;
};

export type TemplateSpec = { kind: CaretakerMessageKind; title: string; description: string; fields: FieldSpec[] };

export const CARETAKER_TEMPLATES: readonly TemplateSpec[] = [
  {
    kind: "salary_credited",
    title: "Salary credited",
    description: "Tell her this month's salary has been paid.",
    fields: [
      { key: "month", label: "Salary for", type: "month", required: true },
      { key: "date", label: "Paid on", type: "date", required: true },
      { key: "method", label: "Paid by", type: "choice", required: true, options: PAYMENT_METHODS },
      { key: "note", label: "Add a line (optional)", type: "text", required: false, max: 200 },
    ],
  },
  {
    kind: "bonus_credited",
    title: "Festival bonus credited",
    description: "A Puja or festival bonus has been paid.",
    fields: [
      { key: "occasion", label: "Occasion", type: "text", required: true, max: 40, hint: "e.g. Durga Puja" },
      { key: "date", label: "Paid on", type: "date", required: true },
      { key: "method", label: "Paid by", type: "choice", required: true, options: PAYMENT_METHODS },
      { key: "note", label: "Add a line (optional)", type: "text", required: false, max: 200 },
    ],
  },
  {
    kind: "day_off",
    title: "Day off approved",
    description: "Confirm leave she asked for.",
    fields: [
      { key: "from", label: "From", type: "date", required: true },
      { key: "to", label: "To (last day off)", type: "date", required: true },
      { key: "note", label: "Add a line (optional)", type: "text", required: false, max: 200 },
    ],
  },
  {
    kind: "notice",
    title: "Notice about the house",
    description: "Anything else. Start lines with - to make a list.",
    fields: [
      { key: "subject", label: "Subject", type: "text", required: true, max: 60 },
      { key: "message", label: "Message", type: "longtext", required: true, max: 1000 },
    ],
  },
];

export type CaretakerFields = Record<string, string>;

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function prettyMonth(value: string): string {
  const m = MONTH.exec(value);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : value;
}

export function prettyDate(value: string): string {
  if (!DATE.test(value)) return value;
  const [y, m, d] = value.split("-").map(Number);
  return `${d} ${MONTHS[m! - 1]!.slice(0, 3)} ${y}`;
}

/** Text the owner typed, made safe for a WhatsApp message: no control characters, no stray formatting marks. */
function cleanText(raw: string, multiline: boolean): string {
  // eslint-disable-next-line no-control-regex
  let text = raw.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  text = text.replace(/[*_~`]/g, "");
  if (!multiline) text = text.replace(/\s+/g, " ");
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type ValidatedMessage = { ok: true; kind: CaretakerMessageKind; fields: CaretakerFields } | { ok: false; error: string };

/** Checks a message the owner composed, field by field, against its template. */
export function validateCaretakerMessage(body: unknown): ValidatedMessage {
  const b = (body ?? {}) as Record<string, unknown>;
  const template = CARETAKER_TEMPLATES.find((t) => t.kind === b.kind);
  if (!template) return { ok: false, error: "Choose what the message is about." };
  const raw = (b.fields ?? {}) as Record<string, unknown>;
  const fields: CaretakerFields = {};
  for (const spec of template.fields) {
    const value = typeof raw[spec.key] === "string" ? (raw[spec.key] as string) : "";
    const cleaned = spec.type === "month" || spec.type === "date" || spec.type === "choice" ? value.trim() : cleanText(value, spec.type === "longtext");
    if (!cleaned) {
      if (spec.required) return { ok: false, error: `${spec.label} is needed.` };
      continue;
    }
    if (spec.type === "month" && !MONTH.test(cleaned)) return { ok: false, error: `${spec.label}: choose a month.` };
    if (spec.type === "date" && !DATE.test(cleaned)) return { ok: false, error: `${spec.label}: choose a date.` };
    if (spec.type === "choice" && !spec.options?.includes(cleaned)) return { ok: false, error: `${spec.label}: choose one of the options.` };
    if (spec.max && cleaned.length > spec.max) return { ok: false, error: `${spec.label} is too long (${spec.max} characters at most).` };
    fields[spec.key] = cleaned;
  }
  if (template.kind === "day_off" && fields.to! < fields.from!) return { ok: false, error: "The last day off is before the first." };
  return { ok: true, kind: template.kind, fields };
}

function paidOn(date: string, today: string): string {
  return date === today ? `today, ${prettyDate(date)}` : `on ${prettyDate(date)}`;
}

/** Lines that start with "-" or "•" become a • list; everything else stays as written. */
function asWhatsappBody(message: string): string {
  return message
    .split("\n")
    .map((line) => (/^[-•]\s*/.test(line) ? `• ${line.replace(/^[-•]\s*/, "")}` : line))
    .join("\n");
}

/**
 * The finished message. `today` is the owner's date in IST (YYYY-MM-DD), so
 * "today" is said only when it is true.
 */
export function renderCaretakerMessage(
  kind: CaretakerMessageKind,
  fields: CaretakerFields,
  people: { caretakerName: string | null; ownerSignature: string },
  today: string,
): string {
  const greeting = people.caretakerName ? `Dear ${people.caretakerName},` : "Hello,";
  const note = fields.note ? [fields.note] : [];
  let body: string[];

  switch (kind) {
    case "salary_credited":
      body = [
        `This is to let you know that your salary for *${prettyMonth(fields.month!)}* has been credited ${paidOn(fields.date!, today)}, by ${fields.method}.`,
        ...note,
        "Please check, and let me know if anything does not look right.",
        "Thank you for looking after the house so well.",
      ];
      break;
    case "bonus_credited":
      body = [
        `Your *${fields.occasion}* bonus has been credited ${paidOn(fields.date!, today)}, by ${fields.method}.`,
        ...note,
        `Wishing you and your family a very happy ${fields.occasion}.`,
      ];
      break;
    case "day_off": {
      const range =
        fields.from === fields.to
          ? `on *${prettyDate(fields.from!)}*`
          : `from *${prettyDate(fields.from!)}* to *${prettyDate(fields.to!)}*`;
      body = [`Your leave ${range} is approved.`, ...note, "Please let me know who will look after the house while you are away."];
      break;
    }
    case "notice":
      body = [`*${fields.subject}*`, asWhatsappBody(fields.message!)];
      break;
  }

  return [PROPERTY_LINE, "", greeting, "", body.join("\n\n"), "", "Warm regards,", people.ownerSignature, "Raj Kuthir Homestays – Sobuj Potro"].join("\n");
}

/** A wa.me link that opens the owner's own WhatsApp on the caretaker's chat with the message typed. */
export function caretakerWhatsappLink(phone: string, text: string): string | null {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = `91${digits}`;
  if (!/^91[6-9]\d{9}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Today's date in India, for "credited today". */
export function istToday(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
