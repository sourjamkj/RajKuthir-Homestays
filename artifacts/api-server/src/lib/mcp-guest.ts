import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { priceCheck, readParty, startGuestBookingHold } from "../routes/book";

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
      return json({ ...(await priceCheck(read.party)), acceptedParty: read.party });
    },
  );

  server.registerTool(
    "start_stay_booking",
    {
      title: "Hold dates and create a payment link",
      description:
        "Use ONLY after the guest has explicitly accepted the exact quote from quote_stay. Copy the acceptedQuote object exactly from that tool result, and use the guest's current WhatsApp number as phone. This creates a temporary hold and secure Book & Pay link, NOT a confirmed booking. The server rechecks dates, party and price; if anything changed it refuses and returns the updated quote for the guest to accept again. Verified Cashfree/Razorpay online payment confirms automatically through the existing payment service. UPI QR/UTR or a screenshot is NOT verified payment and stays pending for owner verification. Never claim the booking is confirmed merely because a payment claim or screenshot was sent.",
      inputSchema: {
        name: z.string().trim().min(2).max(120),
        phone: z.string().trim().min(8).max(20),
        email: z.string().trim().email().max(200).optional(),
        requests: z.string().trim().max(1000).optional(),
        checkIn: ISO,
        checkOut: ISO,
        adults: z.number().int().min(1).max(5),
        children: z.number().int().min(0).max(5),
        pets: z.number().int().min(0).max(4),
        acceptedQuote: z.object({
          checkIn: ISO,
          checkOut: ISO,
          adults: z.number().int().min(1).max(5),
          children: z.number().int().min(0).max(5),
          pets: z.number().int().min(0).max(4),
          totalPaise: z.number().int().positive().safe(),
          advancePaise: z.number().int().nonnegative().safe(),
        }),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ acceptedQuote, ...input }) => {
      if (
        acceptedQuote.checkIn !== input.checkIn ||
        acceptedQuote.checkOut !== input.checkOut ||
        acceptedQuote.adults !== input.adults ||
        acceptedQuote.children !== input.children ||
        acceptedQuote.pets !== input.pets
      ) {
        return { content: [{ type: "text" as const, text: "The stay details do not match the accepted quote. Re-check availability and ask the guest to accept the current quote." }], isError: true };
      }

      const result = await startGuestBookingHold({ ...input, acceptedQuote });
      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          isError: true,
        };
      }
      return json({
        holdCreated: true,
        confirmed: false,
        reference: result.reference,
        payUrl: result.payUrl,
        holdExpiresAt: result.holdExpiresAt,
        totalPaise: result.totalPaise,
        advancePaise: result.advancePaise,
        resumed: result.resumed,
        paymentInstructions: {
          onlinePaymentAutoConfirmsOnlyAfterProviderVerification: result.onlinePayment,
          upiAvailable: result.upiAvailable,
          upiUtrOrScreenshotNeedsOwnerVerification: result.upiAvailable,
        },
      });
    },
  );

  return server;
}
