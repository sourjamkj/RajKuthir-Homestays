import type { ActivityItem } from "./activity-rules";
import type { OwnerEvent } from "./owner-settings-rules";

/**
 * What the owner's phone says, in a line or two, for each thing that happens.
 * Pure. These go to the owner only, so amounts are fine here (unlike the
 * caretaker's messages).
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDay(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "?";
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m! - 1]}`;
}

export const stayText = (checkIn: string | null, checkOut: string | null) => `${shortDay(checkIn)} → ${shortDay(checkOut)}`;

export const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

/** "6:45 pm" in India. */
export function istTime(at: Date): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(at).toLowerCase();
}

export function holdAlert(x: { guestName: string; checkIn: string | null; checkOut: string | null; advancePaise: number; payBy: Date }) {
  return {
    title: `New booking: ${x.guestName}`,
    body: `${stayText(x.checkIn, x.checkOut)} · ${rupees(x.advancePaise)} advance due by ${istTime(x.payBy)}. Payment pending.`,
  };
}

export function utrAlert(x: { guestName: string; checkIn: string | null; checkOut: string | null; advancePaise: number; utr: string; hasScreenshot: boolean }) {
  return {
    title: `Payment to confirm: ${x.guestName}`,
    body: `${rupees(x.advancePaise)} advance · UTR ${x.utr}${x.hasScreenshot ? " + screenshot" : ""} · ${stayText(x.checkIn, x.checkOut)}. Check the bank, then confirm.`,
  };
}

export function reviewAlert(x: { reviewerName: string | null; rating: number | null; text: string | null }) {
  const stars = x.rating ? `${x.rating}★` : "New";
  const text = (x.text ?? "").replace(/\s+/g, " ").trim();
  return {
    title: `${stars} Google review from ${x.reviewerName?.trim() || "a guest"}`,
    body: text ? (text.length > 140 ? `${text.slice(0, 139)}…` : text) : "No text, just the rating. A reply is drafted for you.",
  };
}

export function checkinTomorrowAlert(x: { guestName: string | null; source: string; checkIn: string; checkOut: string; guests: number | null }) {
  const who = x.guestName?.trim() || "A guest";
  const party = x.guests ? ` · ${x.guests} guest${x.guests === 1 ? "" : "s"}` : "";
  return { title: `Check-in tomorrow: ${who}`, body: `${stayText(x.checkIn, x.checkOut)}${party} · ${sourceName(x.source)}` };
}

export function sourceName(source: string): string {
  return ({ direct: "Direct", bookingCom: "Booking.com", airbnb: "Airbnb", makeMyTrip: "MakeMyTrip", manual: "Owner block" } as Record<string, string>)[source] ?? source;
}

/**
 * Which alert an activity item becomes. Website bookings the owner confirmed
 * himself, and Book & Pay steps (alerted where they happen), are not pushed
 * again from here.
 */
export function eventForActivity(item: Pick<ActivityItem, "kind" | "source">): OwnerEvent | null {
  switch (item.kind) {
    case "booking_new":
      return item.source && item.source !== "direct" ? "ota_booking" : null;
    case "ota_block":
      return "ota_booking";
    case "booking_cancelled":
      return "ota_cancellation";
    case "enquiry_new":
      return "enquiry";
    case "documents_uploaded":
      return "documents_uploaded";
    case "feedback":
      return "guest_feedback";
    default:
      return null;
  }
}

/** Tomorrow in India, YYYY-MM-DD. */
export function istTomorrow(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10);
}

/** The evening check-in alert goes once a day, from 18:00 IST. */
export function isEveningRun(now: Date): boolean {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return ist.getUTCHours() >= 18;
}
