/**
 * The WhatsApp reply agent's rules: what it knows, what it may do, and when
 * it stays quiet. Pure, so the tests run without a database or a model.
 *
 * The agent answers guests who message +91 84201 13934, in real time, with a
 * Claude model. It can check dates and price a stay from the rate card (the
 * owner chose fully automatic rate-card quotes), send the guest their
 * booking link with a 24-hour hold, and hand the chat to the owner. It never
 * agrees a price, a discount, a refund or an exception: those go to the owner.
 */

export const MAX_TURNS = 4;
/** Replies to one number per hour before the agent hands over instead. */
export const MAX_REPLIES_PER_HOUR = 20;
/** How long a handed-over chat stays with the owner before the agent may answer again. */
export const HANDOFF_HOURS = 24;
/** Messages of history the model sees. */
export const HISTORY_LIMIT = 20;

export type HistoryRow = { direction: "inbound" | "outbound"; text: string | null };
export type AgentMessage = { role: "user" | "assistant"; content: string };

/** Oldest first, empty bodies dropped, same-side runs merged (the API wants turns to alternate, starting with the guest). */
export function historyToMessages(rows: readonly HistoryRow[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const row of rows) {
    const text = row.text?.trim();
    if (!text) continue;
    const role = row.direction === "inbound" ? "user" : "assistant";
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n${text}`;
    else out.push({ role, content: text });
  }
  while (out.length && out[0]!.role !== "user") out.shift();
  return out;
}

export type ReplyDecision = { reply: true } | { reply: false; reason: string };

/** Whether the agent answers this message at all. */
export function shouldAgentReply(input: {
  state: "bot" | "human";
  mutedUntil: Date | null;
  now: Date;
  repliesLastHour: number;
  hasText: boolean;
}): ReplyDecision {
  if (input.state === "human" && input.mutedUntil && input.mutedUntil > input.now) {
    return { reply: false, reason: "The owner has this chat." };
  }
  if (input.repliesLastHour >= MAX_REPLIES_PER_HOUR) return { reply: false, reason: "Reply limit reached for this hour." };
  if (!input.hasText) return { reply: false, reason: "Not a text message." };
  return { reply: true };
}

/** Plain words that mean "a person, please" in English, Bengali or Hindi. */
const HUMAN_ASK = /\b(human|real person|owner|manager|call me|speak to|talk to)\b|মালিক|কথা বলতে|फोन करो|बात करनी/i;
export const wantsHuman = (text: string): boolean => HUMAN_ASK.test(text);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const count = (v: unknown, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null;

export type StayArgs = { checkIn: string; checkOut: string; adults: number; children: number; pets: number };

/** The model's tool arguments, checked before anything is priced or held. */
export function parseStayArgs(raw: Record<string, unknown>, today: string): { ok: true; stay: StayArgs } | { ok: false; error: string } {
  const checkIn = raw["check_in"];
  const checkOut = raw["check_out"];
  if (typeof checkIn !== "string" || typeof checkOut !== "string" || !ISO.test(checkIn) || !ISO.test(checkOut)) {
    return { ok: false, error: "Dates must be YYYY-MM-DD. Ask the guest for exact dates." };
  }
  if (checkIn < today) return { ok: false, error: "Check-in is in the past. Ask the guest which dates they mean." };
  if (checkOut <= checkIn) return { ok: false, error: "Check-out must be after check-in." };
  const adults = count(raw["adults"], 20);
  const children = count(raw["children"] ?? 0, 20);
  const pets = count(raw["pets"] ?? 0, 10);
  if (adults === null || adults < 1) return { ok: false, error: "Ask how many adults are coming." };
  if (children === null || pets === null) return { ok: false, error: "Children and pets must be whole numbers." };
  return { ok: true, stay: { checkIn, checkOut, adults, children, pets } };
}

export const AGENT_TOOLS = [
  {
    name: "check_dates",
    description:
      "Checks whether the villa is free for the dates and prices the stay from the live rate card. Call it before stating any availability or price. Never state a price that did not come from this tool.",
    input_schema: {
      type: "object",
      properties: {
        check_in: { type: "string", description: "YYYY-MM-DD" },
        check_out: { type: "string", description: "YYYY-MM-DD" },
        adults: { type: "integer" },
        children: { type: "integer" },
        pets: { type: "integer" },
      },
      required: ["check_in", "check_out", "adults"],
    },
  },
  {
    name: "send_booking_link",
    description:
      "When the guest wants to go ahead with dates that check_dates found free: records the enquiry, holds the dates for 24 hours and sends the guest a message with the price, their ready-to-pay booking link and UPI details. Use only after the guest says yes.",
    input_schema: {
      type: "object",
      properties: {
        check_in: { type: "string" },
        check_out: { type: "string" },
        adults: { type: "integer" },
        children: { type: "integer" },
        pets: { type: "integer" },
        guest_name: { type: "string", description: "The name the guest gave, if any." },
      },
      required: ["check_in", "check_out", "adults"],
    },
  },
  {
    name: "handoff_to_owner",
    description:
      "Passes the chat to Sourja (the owner). Use for: discounts or a different price, refunds or cancellations, complaints, early check-in or late check-out, extra guests beyond the booking, anything about an existing booking, questions the facts do not answer, or when the guest asks for a person.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string", description: "One line for the owner: what the guest needs." } },
      required: ["reason"],
    },
  },
] as const;

export function buildSystemPrompt(input: { facts: string; houseRules: string; today: string; hostName: string; hostPhone: string }): string {
  return `You are the WhatsApp assistant for Raj Kuthir Homestays – Sobuj Potro, a private two-bedroom villa in Bolpur, Santiniketan, run by ${input.hostName}. Today is ${input.today} (India time).

How to reply:
- Warm, short and clear, like a helpful host. WhatsApp style: a few short lines, bullets with "•", no markdown headings or bold.
- Reply in the guest's language (English, Bengali or Hindi).
- Use only the facts below and what your tools return. If you do not know something, say you will check with ${input.hostName} and call handoff_to_owner. Never guess.
- Prices: only from check_dates. Never offer, hint at or agree a discount, a different price, a refund or an exception. Those go to ${input.hostName} via handoff_to_owner.
- To quote, you need check-in and check-out dates and the number of adults (ask about children and pets). Then call check_dates and give the total, the advance and that the balance is paid at check-in.
- When the guest wants to book, call send_booking_link. Tell them the message with their booking link and UPI details is on its way and the dates are held for 24 hours.
- Never claim a booking is confirmed. A booking is confirmed only when the advance is paid.
- Do not ask for ID documents, card numbers or passwords.
- If the guest asks for a person, or is upset, call handoff_to_owner and tell them ${input.hostName} will reply here soon (urgent: call ${input.hostPhone}).

FACTS
${input.facts}

HOUSE RULES (published)
${input.houseRules}`;
}
