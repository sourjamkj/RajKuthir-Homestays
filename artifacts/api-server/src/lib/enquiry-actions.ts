import { findByEnquiryId } from "./book-pay-repo";
import { convertEnquiry } from "./enquiry-convert-service";
import { holdExpiryOf } from "./enquiry-hold";
import { SITE } from "./enquiry-followup";
import { offerUrl } from "./enquiry-offer-rules";
import { offerTokenFor } from "./enquiry-offers";
import { termsOf } from "./enquiry-terms";
import { loadPricer } from "./enquiry-view";
import { getEnquiry, markQuoteSent, setBookingDetails } from "./enquiries-repo";
import { sendConfirmation } from "./invoices";
import { logger } from "./logger";
import { sendTemplate, toWhatsappNumber } from "./whatsapp-client";
import { guestApiSendingOn } from "./whatsapp-mode";
import { buildEnquiryQuoteTemplate, upiDetails } from "./whatsapp-templates";

/**
 * The two enquiry actions that do real work — sending the quote and booking
 * with the owner's details — in one place, so the web console, the phone app
 * and the Claude connector all run exactly the same code.
 *
 * Each returns either the response body or the HTTP status and the reason,
 * never throws for a refusal the owner should read.
 */

export type ActionResult<T> = { ok: true; body: T } | { ok: false; status: number; body: Record<string, unknown> };

const refuse = (status: number, error: string): ActionResult<never> => ({ ok: false, status, body: { error } });

/**
 * Sends the guest their quote and the UPI details to confirm with (or, with
 * the Business API off, returns the wa.me link for the owner to send).
 *
 * The order matters: price it, send it, and only then record it. The quote is
 * the owner's agreed price when he set one, else the rate card.
 */
export async function sendEnquiryQuote(id: string) {
  const enquiry = await getEnquiry(id);
  if (!enquiry) return refuse(404, "That enquiry no longer exists.");

  const upi = upiDetails();
  if (!upi) {
    return refuse(503, "RAJ_KUTHIR_UPI_ID and RAJ_KUTHIR_UPI_NAME are not set on the server, so there are no payment details to send.");
  }

  const to = toWhatsappNumber(enquiry.phone);
  if (!to) return refuse(422, "That phone number cannot be used for WhatsApp.");

  const quote = (await loadPricer())(enquiry, await termsOf(id));
  if (!quote.ok) return refuse(422, quote.reason);

  // The deadline the guest is told and the hold on the screen share this instant.
  const sentAt = new Date();
  const token = await offerTokenFor(id);
  const template = buildEnquiryQuoteTemplate({
    guestName: enquiry.name,
    quote,
    upi,
    holdExpiresAt: holdExpiryOf(sentAt),
    offerUrl: token ? offerUrl(SITE, token) : null,
  });

  // With the Business API on, Meta delivers it; otherwise the owner sends the
  // wa.me link from his own WhatsApp. `delivery` says which, honestly.
  const auto = guestApiSendingOn()
    ? await sendTemplate({ to, templateName: template.name, languageCode: template.languageCode, params: template.params })
    : null;

  if (auto && !auto.ok) {
    logger.error({ enquiryId: id, error: auto.error, retryable: auto.retryable }, "Could not send the enquiry quote");
    return refuse(502, auto.error);
  }

  // Recorded either way: the hold is measured from quoteSentAt. On the manual
  // path DELETE /enquiries/:id/quote undoes it if it never went out.
  const updated = await markQuoteSent(id, { totalPaise: quote.totalPaise, advancePaise: quote.advancePaise }, sentAt);

  logger.info(
    { enquiryId: id, nights: quote.nights, guests: quote.guests, delivery: auto ? "api" : "manual_whatsapp" },
    auto ? "Enquiry quote sent" : "Enquiry quote prepared for manual WhatsApp send",
  );

  return {
    ok: true as const,
    body: {
      enquiry: updated,
      quote,
      preview: template.preview,
      delivery: (auto ? "api" : "manual_whatsapp") as "api" | "manual_whatsapp",
      whatsappUrl: auto ? null : `https://wa.me/${to}?text=${encodeURIComponent(template.preview)}`,
    },
  };
}

/**
 * "Book with my details": dates, party, the agreed total and the advance
 * received, and the enquiry becomes a booking in one step, through the same
 * conversion (and duplicate rules) as Create booking.
 */
export async function bookEnquiryWithDetails(id: string, b: Record<string, unknown>) {
  const enquiry = await getEnquiry(id);
  if (!enquiry) return refuse(404, "That enquiry no longer exists.");
  if (enquiry.convertedBookingId) return refuse(409, "This enquiry is already booked.");

  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const whole = (value: unknown, min: number, max: number) => {
    const n = Number(value ?? 0);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  };
  const checkIn = String(b.checkIn ?? "");
  const checkOut = String(b.checkOut ?? "");
  const adults = whole(b.adults, 1, 20);
  const children = whole(b.children, 0, 20);
  const pets = whole(b.pets, 0, 10);
  const total = whole(b.totalRupees, 1, 10_000_000);
  const advance = whole(b.advanceRupees, 0, 10_000_000);

  if (!ISO.test(checkIn) || !ISO.test(checkOut) || checkOut <= checkIn) {
    return refuse(400, "Check-in and check-out dates are needed, with check-out after check-in.");
  }
  if (adults === null || children === null || pets === null) return refuse(400, "Check the number of adults, children and pets.");
  if (total === null) return refuse(400, "Enter the total for the stay in rupees.");
  if (advance === null || advance > total) return refuse(400, "The advance must be between ₹0 and the total.");
  if (advance === 0 && b.confirmWithoutAdvance !== true) {
    return refuse(409, "No advance entered. Tick “Confirm without an advance” if you want to book it anyway.");
  }

  const updated = await setBookingDetails(id, {
    checkIn,
    checkOut,
    adults,
    children,
    pets,
    totalPaise: total * 100,
    advancePaise: advance * 100,
  });
  if (!updated) return refuse(404, "That enquiry no longer exists.");

  const paymentRequest = await findByEnquiryId(id);
  const outcome = await convertEnquiry(updated, { reference: paymentRequest?.reference ?? null });
  if (!outcome.ok) {
    const { ok: _ok, status, ...body } = outcome;
    return { ok: false as const, status, body: body as Record<string, unknown> };
  }

  logger.info({ enquiryId: id, bookingId: outcome.booking.id }, "Enquiry booked with the owner's details");
  // The guest gets the booking confirmation PDF right away: by email, or by WhatsApp when set up.
  const confirmation = outcome.booking.status === "confirmed" ? await sendConfirmation(outcome.booking.id) : null;

  return {
    ok: true as const,
    body: {
      booking: {
        id: outcome.booking.id,
        reference: outcome.booking.reference,
        status: outcome.booking.status,
        checkIn: outcome.booking.checkIn,
        checkOut: outcome.booking.checkOut,
      },
      enquiry: outcome.enquiry,
      confirmation,
    },
  };
}
