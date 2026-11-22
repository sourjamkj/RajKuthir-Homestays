import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { bookings, calendarEvents, db } from "@workspace/db";

import { getEnquiry, setAdvancePaid, setEnquiryStatus } from "./enquiries-repo";
import { convertEnquiry } from "./enquiry-convert-service";
import { createOrRefreshOnboarding } from "./guest-onboarding-repo";
import { SITE_ORIGIN } from "./seo";
import { logPaymentEvent, setDecision, type RequestWithEnquiry } from "./book-pay-repo";
import { confirmedMessage } from "./book-pay-messages";
import { deliverConfirmation } from "./invoices";
import { sendTemplate, toWhatsappNumber } from "./whatsapp-client";
import { guestApiSendingOn } from "./whatsapp-mode";
import { prettyDate, rupees } from "./whatsapp-templates";

/** "Payment received, booking confirmed" + Upload ID button (URL ends in the pre-arrival token). */
export const PAYMENT_RECEIVED_TEMPLATE = "rk_payment_received_id";
import { delivered, deliverySummary } from "./confirmation-delivery";

/**
 * Turning a paid Book & Pay request into a booking. Shared by the owner's
 * "Confirm — money received" button and by automatic confirmation after a
 * Cashfree payment, so both create the booking with exactly the same code as
 * every other converted enquiry: advance-received, then convert.
 */

export function waLink(phone: string | null, message: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  const to = digits.length === 10 ? `91${digits}` : digits.length === 11 && digits.startsWith("0") ? `91${digits.slice(1)}` : digits;
  return to.length >= 11 ? `https://wa.me/${to}?text=${encodeURIComponent(message)}` : null;
}

export type ConfirmOutcome =
  | { ok: false; status: number; body: Record<string, unknown> }
  | {
      ok: true;
      body: {
        booking: { id: string; reference: string; status: string; receivedPaise: number | null };
        emailed: boolean;
        confirmationSentOnWhatsapp: boolean;
        confirmationDelivered: boolean;
        deliverySummary: string;
        whatsappUrl: string | null;
        preview: string;
      };
    };

export async function confirmPaymentRequest(
  found: RequestWithEnquiry,
  options: { force?: boolean; eventDetail?: string } = {},
): Promise<ConfirmOutcome> {
  const { request } = found;

  // Confirmable: waiting, submitted, or EXPIRED — a guest who paid after the
  // hold ran out has still paid. A confirmed one re-sends its message.
  const confirmable = ["submitted", "awaiting_payment", "expired"].includes(request.status);
  if (!confirmable && request.status !== "confirmed") {
    return { ok: false, status: 409, body: { error: `This payment is already ${request.status}.` } };
  }

  let enquiry = found.enquiry;
  let booking: { id: string; reference: string | null; status: string; receivedPaise: number | null } | null = null;

  // Already turned into a booking (an earlier confirm, or the enquiry's own
  // Convert button): use that booking rather than refusing.
  if (enquiry.convertedBookingId) {
    const [existing] = await db
      .select({ id: bookings.id, reference: bookings.reference, status: bookings.status, receivedPaise: bookings.receivedPaise })
      .from(bookings)
      .where(eq(bookings.id, enquiry.convertedBookingId))
      .limit(1);
    booking = existing ?? null;
  }

  if (!booking && request.status === "confirmed") {
    return { ok: false, status: 409, body: { error: "This payment is confirmed but its booking could not be found." } };
  }

  if (!booking) {
    // An OTA may have sold the nights before its next sync picked up the hold.
    // The ledger check inside convert would miss that; look at the calendar.
    if (options.force !== true && enquiry.checkIn && enquiry.checkOut) {
      const otaClash = await db
        .select({ id: calendarEvents.id, source: calendarEvents.source, startDate: calendarEvents.startDate, endDate: calendarEvents.endDate })
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.status, "confirmed"),
            inArray(calendarEvents.source, ["bookingCom", "airbnb", "makeMyTrip", "manual"]),
            lt(calendarEvents.startDate, enquiry.checkOut),
            gt(calendarEvents.endDate, enquiry.checkIn),
          ),
        )
        .limit(1);
      if (otaClash[0]) {
        return {
          ok: false,
          status: 409,
          body: {
            error: `The calendar shows ${otaClash[0].source} holding ${otaClash[0].startDate} to ${otaClash[0].endDate}. Check for a double booking before confirming.`,
            reason: "calendar_clash",
          },
        };
      }
    }

    // Step 1 — the same mark as POST /enquiries/:id/advance-received.
    await setAdvancePaid(request.enquiryId, true);
    const fresh = await getEnquiry(request.enquiryId);
    if (!fresh) {
      return { ok: false, status: 404, body: { error: "The enquiry behind this payment no longer exists." } };
    }
    enquiry = fresh;

    // Step 2 — the same conversion as POST /enquiries/:id/convert.
    const outcome = await convertEnquiry(enquiry, { reference: request.reference });
    if (!outcome.ok) {
      // Leave nothing half-done: the advance mark goes back off.
      await setAdvancePaid(request.enquiryId, false);
      const { ok: _ok, status, ...body } = outcome;
      return { ok: false, status, body };
    }
    booking = outcome.booking;
  }

  if (request.status !== "confirmed") {
    await setDecision(request.id, "confirmed");
    await setEnquiryStatus(request.enquiryId, "converted").catch(() => undefined);
    await logPaymentEvent(
      request.id,
      "confirmed",
      `Booking ${booking.reference ?? request.reference}${options.eventDetail ? ` — ${options.eventDetail}` : ""}`,
    );
  }

  // Guest message: reference, dates, balance, pre-arrival link.
  const onboarding = await createOrRefreshOnboarding(booking.id).catch(() => null);
  const preArrivalUrl = onboarding ? `${SITE_ORIGIN}/pre-arrival#${encodeURIComponent(onboarding.token)}` : null;
  const message = confirmedMessage({
    guestName: enquiry.name,
    reference: booking.reference ?? request.reference,
    checkIn: enquiry.checkIn,
    checkOut: enquiry.checkOut,
    advancePaise: request.advancePaise,
    balancePaise: request.totalPaise - request.advancePaise,
    preArrivalUrl,
  });
  // Email: the message above with the confirmation PDF attached. WhatsApp:
  // "payment received, booking confirmed" with an Upload ID button, sent at
  // once whatever the hour; the PDF with the house rules follows on WhatsApp
  // once the ID is verified (the outbox's booking_confirmed).
  const emailMessage = {
    subject: message.subject,
    text: message.text.replace(
      /\n\nAny questions,/,
      "\n\nYour booking confirmation (PDF) is attached — please keep it handy for check-in.\n\nAny questions,",
    ),
  };
  const delivery = await deliverConfirmation(booking.id, { emailMessage, paymentRequestId: request.id, whatsapp: false });
  const whatsappTo = toWhatsappNumber(enquiry.phone);
  if (guestApiSendingOn() && whatsappTo && onboarding) {
    const sent = await sendTemplate({
      to: whatsappTo,
      templateName: PAYMENT_RECEIVED_TEMPLATE,
      params: [
        enquiry.name.trim().split(/\s+/)[0] || "there",
        prettyDate(booking.checkIn),
        prettyDate(booking.checkOut),
        booking.reference ?? request.reference,
        rupees(request.advancePaise),
        rupees(request.totalPaise - request.advancePaise),
      ],
      urlButtonParam: onboarding.token,
    }).catch((error) => ({ ok: false as const, error: String(error), retryable: false }));
    if (sent.ok) {
      delivery.whatsapp = "sent";
      delivery.whatsappTo = whatsappTo;
    } else {
      delivery.whatsapp = "failed";
      delivery.notes.push(`whatsapp failed (${sent.error})`);
    }
  }
  const summary = deliverySummary(delivery);
  await logPaymentEvent(request.id, "confirmation_sent", summary);

  return {
    ok: true,
    body: {
      booking: {
        id: booking.id,
        reference: booking.reference ?? request.reference,
        status: booking.status,
        receivedPaise: booking.receivedPaise,
      },
      emailed: delivery.email === "sent",
      confirmationSentOnWhatsapp: delivery.whatsapp === "sent",
      confirmationDelivered: delivered(delivery),
      deliverySummary: summary,
      // Today's delivery path for WhatsApp: the owner presses send.
      whatsappUrl: waLink(enquiry.phone, message.text),
      preview: message.text,
    },
  };
}
