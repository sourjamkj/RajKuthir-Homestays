import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { priceCheck, readParty } from "../routes/book";
import { pool } from "@workspace/db";
import { acceptWaFlowSubmission } from "./wa-flow-enquiry";
import {
  expectedPhoneNumberIdMatches,
  parseWaFlowAnswers,
} from "./wa-flow-rules.ts";
import { shouldAutoReply } from "./wa-webhook-rules.ts";

const flowResponseSchema = z
  .object({
    flow_token: z.string().max(512).optional(),
    check_in: z.string(),
    check_out: z.string(),
    adults: z.union([z.string(), z.number()]),
    children: z.union([z.string(), z.number()]),
    bringing_pets: z.union([z.boolean(), z.string()]),
    pet_count: z.union([z.string(), z.number()]).optional(),
  })
  .strict();

/**
 * The guest-facing connector for the WhatsApp agent (Hermes) at /mcp/guest.
 *
 * Unlike the owner's connector (mcp-tools.ts) it exposes only what any guest
 * may see on the public booking page: availability and the price for their
 * dates. No guest names, bookings, enquiries or changes. Later phases add
 * tools here (enquiry, quote, booking link) — never the owner's tools.
 */

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

export function buildGuestMcpServer(): McpServer {
  const server = new McpServer({ name: "raj-kuthir-guest", version: "1.0.0" });

  server.registerTool(
    "quote_stay",
    {
      title: "Price and availability for a stay",
      description:
        "Is Raj Kuthir Homestays – Sobuj Potro (the whole 2-bedroom villa) free for these dates, and what does the stay cost? " +
        "Same answer as the website's booking page. checkOut is the day the guest leaves. Up to 5 guests. " +
        "Money is in paise (₹1 = 100 paise). When not available, nextFree lists the nearest free dates and reason says why " +
        "(taken, or a peak period's minimum stay).",
      inputSchema: {
        checkIn: ISO,
        checkOut: ISO,
        adults: z.number().int().min(1).max(5),
        children: z.number().int().min(0).max(5).optional(),
        pets: z.number().int().min(0).max(4).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const read = readParty(args);
      if (!read.ok)
        return {
          content: [{ type: "text" as const, text: read.error }],
          isError: true,
        };
      return json(await priceCheck(read.party));
    },
  );

  server.registerTool(
    "create_guest_enquiry",
    {
      title: "Accept a WhatsApp booking enquiry",
      description:
        "Accept a validated Meta WhatsApp booking Flow response by its inbound WhatsApp message id. The server verifies that the submitted answers match the stored signed-webhook response and derives the guest phone from that record; never supply or infer a guest phone number. Returns an enquiry reference and current availability/quotation status. This records an enquiry only and never books or blocks dates.",
      inputSchema: {
        messageId: z.string().min(5).max(128),
        response: flowResponseSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ messageId, response }) => {
      const { rows } = await pool.query<{ phone: string; payload: unknown }>(
        `SELECT phone, payload FROM wa_inbound_messages WHERE wa_id = $1 AND direction = 'inbound' LIMIT 1`,
        [messageId],
      );
      const stored = rows[0];
      const payload = stored?.payload as
        | {
            type?: string;
            phone_number_id?: string | null;
            interactive?: {
              type?: string;
              nfm_reply?: { name?: string; response_json?: unknown };
            };
          }
        | undefined;
      const responseJson = payload?.interactive?.nfm_reply?.response_json;
      const storedAnswers = parseWaFlowAnswers(responseJson);
      const suppliedAnswers = parseWaFlowAnswers(response);
      if (
        !stored ||
        !expectedPhoneNumberIdMatches(payload?.phone_number_id) ||
        payload?.type !== "interactive" ||
        payload.interactive?.type !== "nfm_reply" ||
        payload.interactive.nfm_reply?.name !== "flow" ||
        !storedAnswers ||
        !suppliedAnswers ||
        JSON.stringify(storedAnswers) !== JSON.stringify(suppliedAnswers) ||
        !shouldAutoReply(stored.phone)
      ) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                accepted: false,
                error: "No eligible booking enquiry was found.",
              }),
            },
          ],
          isError: true,
        };
      }
      const result = await acceptWaFlowSubmission({
        messageId,
        senderPhone: stored.phone,
        responseJson,
      });
      const { newlyCreated: _newlyCreated, ...publicResult } = result;
      return json(publicResult);
    },
  );

  return server;
}
