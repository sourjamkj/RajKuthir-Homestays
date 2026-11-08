import { randomBytes } from "node:crypto";

/**
 * The ready-to-pay link in an enquiry reply: the guest opens it and sees
 * their dates, party and price already filled in, checks their name, and
 * holds the dates and pays in one step. Pure: no database, no clock.
 *
 * The link carries a random token in the URL fragment (like /pay#…), so it
 * never reaches a server log or a Referer header. It only ever shows that
 * one enquiry's stay and price, and it can only start a hold that the guest
 * then has to pay; the price is always recomputed on the server.
 */

export const OFFER_TOKEN = /^[A-Za-z0-9_-]{24}$/;

export function newOfferToken(): string {
  return randomBytes(18).toString("base64url");
}

export function looksLikeOfferToken(value: unknown): value is string {
  return typeof value === "string" && OFFER_TOKEN.test(value);
}

export function offerUrl(site: string, token: string): string {
  return `${site}/offer#${token}`;
}

/** Why this enquiry cannot be booked from its link right now, in words for the guest; null when it can. */
export function offerProblem(
  enquiry: { status: string; checkIn: string | null; checkOut: string | null; convertedBookingId?: string | null },
  today: string,
): string | null {
  if (enquiry.status === "converted" || enquiry.convertedBookingId) return "This stay is already booked. See you soon!";
  if (enquiry.status === "closed") return "This offer is no longer open. Message us on WhatsApp and we will send you a fresh one.";
  if (!enquiry.checkIn || !enquiry.checkOut) return "This offer has no dates yet. Message us on WhatsApp with your dates.";
  if (enquiry.checkIn < today) return "These dates have passed. Message us on WhatsApp for new dates.";
  return null;
}

/** "98•••••210": enough for the guest to recognise their number, not enough to read it off a shared screen. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").slice(-10);
  return digits.length === 10 ? `${digits.slice(0, 2)}•••••${digits.slice(7)}` : "your number";
}
