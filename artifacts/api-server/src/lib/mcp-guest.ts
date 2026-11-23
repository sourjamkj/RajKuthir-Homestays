import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { priceCheck, readParty } from "../routes/book";

/**
 * The guest-facing connector for the WhatsApp agent (Hermes) at /mcp/guest.
 *
 * Unlike the owner's connector (mcp-tools.ts) it exposes only what any guest
 * may see on the public booking page: availability and the price for their
 * dates. No guest names, bookings, enquiries or changes. Later phases add
 * tools here (enquiry, quote, booking link) — never the owner's tools.
 */

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

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
      if (!read.ok) return { content: [{ type: "text" as const, text: read.error }], isError: true };
      return json(await priceCheck(read.party));
    },
  );

  return server;
}
