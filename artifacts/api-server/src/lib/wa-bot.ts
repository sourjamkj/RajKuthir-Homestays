import { readFileSync } from "node:fs";

import { pool, type Enquiry } from "@workspace/db";

import { firstConflict } from "./availability";
import { listPublicBlocks } from "./calendar-repo";
import { createEnquiry } from "./enquiries-repo";
import { sendEnquiryQuote } from "./enquiry-actions";
import { NO_TERMS } from "./enquiry-terms-rules";
import { loadPricer } from "./enquiry-view";
import { todayInIndia } from "./guest-lookup";
import { findHouseRulesPdf } from "./house-rules";
import { logger } from "./logger";
import { notifyOwner } from "./owner-alerts";
import { securityDepositNote } from "./party";
import { normaliseMobile } from "./phone";
import { llmsTxt } from "./seo";
import {
  AGENT_TOOLS,
  HANDOFF_HOURS,
  HISTORY_LIMIT,
  MAX_TURNS,
  buildSystemPrompt,
  historyToMessages,
  parseStayArgs,
  shouldAgentReply,
  wantsHuman,
  type HistoryRow,
} from "./wa-agent-rules";
import { getOrCreateConversation, storeOutbound } from "./wa-webhook";
import type { InboundMessage } from "./wa-webhook-rules";
import { sendText } from "./whatsapp-client";

/**
 * The WhatsApp reply agent. The webhook stores each guest message and calls
 * handleInbound; this decides whether to answer, asks a Claude model with
 * the villa's facts and three tools (check dates, send booking link, hand
 * to owner), and sends the answer back on WhatsApp. Rules and limits are in
 * wa-agent-rules.ts. Never throws.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-5";
const HOST_NAME = "Sourja";
const HOST_PHONE = "+91 62903 99165";

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

let houseRulesText: string | null = null;
function houseRules(): string {
  if (houseRulesText === null) {
    const pdf = findHouseRulesPdf();
    try {
      houseRulesText = pdf ? readFileSync(pdf.replace(/\.pdf$/, ".txt"), "utf8") : "";
    } catch {
      houseRulesText = "";
    }
  }
  return houseRulesText || "See https://rajkuthirhomestays.casa/house-rules";
}

function facts(): string {
  return [
    llmsTxt(),
    "",
    "More facts:",
    "- Food: Cafe Soi in the villa grounds serves breakfast, Bengali home cooking, tea and snacks (menu: https://rajkuthirhomestays.casa/cafe-soi-shantiniketan). Home-cooked meals can also be arranged with the caretaker.",
    `- ${securityDepositNote()}.`,
    "- Caretaker (arrival, meals, local help): +91 78726 85558.",
    "- Directions: https://maps.app.goo.gl/aEdaJaaeEy1DZ8Ps8",
    "- Photos: https://rajkuthirhomestays.casa/gallery · Live availability: https://rajkuthirhomestays.casa/#availability",
    "- Booking direct costs less than the booking apps. The advance confirms the booking; the balance is paid at check-in. Peak-period stays are paid in full at booking.",
  ].join("\n");
}

async function history(phone: string): Promise<HistoryRow[]> {
  const { rows } = await pool.query<HistoryRow>(
    `SELECT direction, body_text AS text FROM (
       SELECT direction, body_text, created_at FROM wa_inbound_messages
       WHERE phone = $1 ORDER BY created_at DESC LIMIT $2
     ) recent ORDER BY created_at ASC`,
    [phone, HISTORY_LIMIT],
  );
  return rows;
}

async function repliesLastHour(phone: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM wa_inbound_messages WHERE phone = $1 AND direction = 'outbound' AND created_at > now() - interval '1 hour'`,
    [phone],
  );
  return Number(rows[0]?.n ?? 0);
}

async function reply(phone: string, text: string): Promise<void> {
  const sent = await sendText({ to: phone, text });
  if (!sent.ok) {
    logger.warn({ phone, error: sent.error }, "WhatsApp agent reply was not sent");
    return;
  }
  await storeOutbound({ waId: sent.providerMessageId, phone, type: "text", text });
}

async function handOff(phone: string, reason: string, now: Date): Promise<void> {
  await pool.query(`UPDATE wa_conversations SET state = 'human', muted_until = $2, updated_at = now() WHERE phone = $1`, [
    phone,
    new Date(now.getTime() + HANDOFF_HOURS * 3_600_000),
  ]);
  await notifyOwner(
    {
      event: "enquiry",
      title: "WhatsApp: a guest needs you",
      body: `+${phone}: ${reason}. The assistant has stopped answering this chat for ${HANDOFF_HOURS} hours; reply from Inbox.`,
      href: "/admin/inbox",
      dedupeKey: `wa-handoff-${phone}-${now.toISOString().slice(0, 13)}`,
    },
    now,
  );
}

/** Runs one tool call. Returns the text the model sees. */
async function runTool(name: string, input: Record<string, unknown>, ctx: { phone: string; now: Date }): Promise<string> {
  if (name === "handoff_to_owner") {
    await handOff(ctx.phone, String(input["reason"] ?? "The guest needs the owner"), ctx.now);
    return "Done. Tell the guest Sourja will reply here soon.";
  }
  const parsed = parseStayArgs(input, todayInIndia(ctx.now));
  if (!parsed.ok) return parsed.error;
  const { stay } = parsed;

  const clash = firstConflict({ startDate: stay.checkIn, endDate: stay.checkOut }, await listPublicBlocks());
  if (clash) return `Not available: the villa is booked from ${clash.startDate} to ${clash.endDate}. Suggest other dates or the live calendar.`;

  const quote = (await loadPricer())(
    { id: "whatsapp", name: "", phone: ctx.phone, status: "new", ...stay, convertedBookingId: null } as unknown as Enquiry,
    NO_TERMS,
  );
  if (!quote.ok) return `Cannot price this stay automatically: ${quote.reason}`;

  if (name === "check_dates") {
    return JSON.stringify({
      available: true,
      nights: quote.nights,
      guests: quote.guests,
      total: rupees(quote.totalPaise),
      advance_to_confirm: rupees(quote.advancePaise),
      balance_at_checkin: rupees(quote.balancePaise),
      pets_charge: quote.petPaise ? rupees(quote.petPaise) : null,
      extra_guest_charge: quote.extraGuestPaise ? rupees(quote.extraGuestPaise) : null,
      peak_period: quote.peak,
      security_deposit: securityDepositNote(),
    });
  }

  if (name === "send_booking_link") {
    const enquiry = await createEnquiry({
      name: typeof input["guest_name"] === "string" && input["guest_name"].trim() ? input["guest_name"].trim().slice(0, 200) : "WhatsApp guest",
      phone: normaliseMobile(`+${ctx.phone}`) ?? `+${ctx.phone}`,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      adults: stay.adults,
      children: stay.children,
      pets: stay.pets,
      requests: "Via the WhatsApp assistant",
    });
    const sent = await sendEnquiryQuote(enquiry.id);
    if (!sent.ok) return `Could not send the booking link (${String(sent.body["error"])}). Hand the chat to the owner.`;
    return "Sent: the guest has a message with the price, their booking link and UPI details. Dates held 24 hours.";
  }
  return `Unknown tool ${name}.`;
}

type ContentBlock = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

/** The model's answer for this conversation, running tools as it asks. */
async function askModel(messages: unknown[], ctx: { phone: string; now: Date }): Promise<string | null> {
  const key = process.env["ANTHROPIC_API_KEY"]!.trim();
  const system = buildSystemPrompt({ facts: facts(), houseRules: houseRules(), today: todayInIndia(ctx.now), hostName: HOST_NAME, hostPhone: HOST_PHONE });
  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env["WHATSAPP_AGENT_MODEL"]?.trim() || DEFAULT_MODEL,
        max_tokens: 700,
        system,
        tools: AGENT_TOOLS,
        messages,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json().catch(() => ({}))) as { content?: ContentBlock[]; stop_reason?: string; error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
    const content = body.content ?? [];
    const uses = content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
    if (!uses.length) {
      return content.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim() || null;
    }
    messages.push({ role: "assistant", content });
    const results = [];
    for (const use of uses) results.push({ type: "tool_result", tool_use_id: use.id, content: await runTool(use.name, use.input, ctx) });
    messages.push({ role: "user", content: results });
  }
  return null;
}

export async function handleInbound(msg: InboundMessage, now = new Date()): Promise<void> {
  try {
    const conversation = await getOrCreateConversation(msg.phone);
    const decision = shouldAgentReply({
      state: conversation.state,
      mutedUntil: conversation.mutedUntil,
      now,
      repliesLastHour: await repliesLastHour(msg.phone),
      hasText: Boolean(msg.text?.trim()),
    });
    if (!decision.reply) {
      logger.info({ phone: msg.phone, reason: decision.reason }, "WhatsApp agent did not reply");
      return;
    }
    if (conversation.state === "human") await pool.query(`UPDATE wa_conversations SET state = 'bot' WHERE phone = $1`, [msg.phone]);

    if (!process.env["ANTHROPIC_API_KEY"]?.trim() || wantsHuman(msg.text!)) {
      await handOff(msg.phone, wantsHuman(msg.text!) ? "Asked to speak to the owner" : "New message (the assistant has no AI key yet)", now);
      await reply(msg.phone, `Thank you for your message! ${HOST_NAME} will reply here shortly. For anything urgent, call ${HOST_PHONE}.`);
      return;
    }

    const answer = await askModel(historyToMessages(await history(msg.phone)), { phone: msg.phone, now });
    if (answer) await reply(msg.phone, answer);
    else await handOff(msg.phone, "The assistant could not answer", now);
  } catch (error) {
    logger.error({ err: error, phone: msg.phone }, "WhatsApp agent failed; handing the chat to the owner");
    await handOff(msg.phone, "The assistant hit an error", now).catch(() => undefined);
  }
}
