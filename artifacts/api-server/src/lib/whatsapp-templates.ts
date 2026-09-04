import type { Booking } from "@workspace/db";

/**
 * The four message templates, and how a booking fills them in.
 *
 * `name` must match a template approved in Meta > WhatsApp Manager exactly,
 * and the number of `{{n}}` placeholders in Meta's body must match the
 * `params` array below or the send is rejected. `preview` exists so the owner
 * can read what a guest will receive without logging into Meta.
 *
 * Category matters for cost and consent: utility templates are transactional
 * and cheap; marketing templates need opt-in and are billed higher. Keep the
 * category here in step with what was submitted for approval.
 */

export type MessageKind =
  | "booking_confirmed"
  | "checkin_reminder"
  | "checkout_today"
  | "review_request";

export type TemplateSpec = {
  name: string;
  category: "utility" | "marketing";
  languageCode: string;
  params: string[];
  preview: string;
};

const CONTACT = {
  hostPhone: "+91 62903 99165",
  caretakerPhone: "+91 78726 85558",
  mapsUrl: "https://maps.app.goo.gl/D1tUUb3JfpVdcHwu5",
  reviewUrl: "https://maps.app.goo.gl/Ptrm6eaXuXNoiXBbA?g_st=ac",
};

/** "2026-09-14" -> "14 Sep 2026", which is how a guest reads a date. */
function prettyDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** First name only — "Dear Mr Sourja Mukherjee" reads like a bank letter. */
function firstName(full: string | null): string {
  const name = (full ?? "").trim().split(/\s+/)[0];
  return name || "there";
}

export function buildTemplate(
  kind: MessageKind,
  booking: Booking,
): TemplateSpec {
  const guest = firstName(booking.guestName);
  const arrive = prettyDate(booking.checkIn);
  const depart = prettyDate(booking.checkOut);
  const nights = nightsBetween(booking.checkIn, booking.checkOut);

  switch (kind) {
    case "booking_confirmed":
      return {
        name: "rk_booking_confirmed",
        category: "utility",
        languageCode: "en",
        params: [guest, arrive, depart, String(nights)],
        preview:
          `Hello ${guest}, your stay at Raj Kuthir Homestays (Sobuj Potro) is confirmed — ` +
          `${arrive} to ${depart}, ${nights} night${nights === 1 ? "" : "s"}. ` +
          `We will send directions the day before you arrive. ` +
          `Any questions, reply here or call ${CONTACT.hostPhone}.`,
      };

    case "checkin_reminder":
      return {
        name: "rk_checkin_reminder",
        category: "utility",
        languageCode: "en",
        params: [guest, arrive, CONTACT.caretakerPhone],
        preview:
          `Hello ${guest}, we are looking forward to seeing you tomorrow, ${arrive}. ` +
          `Check-in is from 12 noon. Directions: ${CONTACT.mapsUrl} — ` +
          `our caretaker is on ${CONTACT.caretakerPhone} if anything comes up on the way.`,
      };

    case "checkout_today":
      return {
        name: "rk_checkout_today",
        category: "utility",
        languageCode: "en",
        params: [guest, CONTACT.caretakerPhone],
        preview:
          `Good morning ${guest}. Check-out is by 11 am today. ` +
          `Please leave the keys with the caretaker (${CONTACT.caretakerPhone}). ` +
          `Thank you for staying with us — travel safely.`,
      };

    case "review_request":
      return {
        name: "rk_review_request",
        category: "marketing",
        languageCode: "en",
        params: [guest, CONTACT.reviewUrl],
        preview:
          `Hello ${guest}, we hope you got home well. If Sobuj Potro treated you kindly, ` +
          `a short Google review helps other travellers find us: ${CONTACT.reviewUrl}. ` +
          `Thank you — you are welcome back any time.`,
      };
  }
}
