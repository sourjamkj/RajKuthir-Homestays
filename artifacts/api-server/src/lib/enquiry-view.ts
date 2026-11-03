import { normalisePhone, type Enquiry } from "@workspace/db";

import { holdDeadlinesByEnquiry } from "./book-pay-repo";
import { listAllEvents } from "./calendar-repo";
import { datesTakenFor } from "./enquiry-clash";
import { buildEnquiryFollowUp, isReturningGuest } from "./enquiry-followup";
import { holdStateOf } from "./enquiry-hold";
import { quoteForEnquiry, type QuoteResult } from "./enquiry-quote";
import { termsFor } from "./enquiry-terms";
import { NO_TERMS, withAgreedPrice, type EnquiryTerms } from "./enquiry-terms-rules";
import { listContacts } from "./enquiries-repo";
import { todayInIndia } from "./guest-lookup";
import { getRatePlan, minimumStay, rateForNight, stayNightPrices } from "./rates-repo";

/**
 * An enquiry as every screen shows it: the price (the owner's agreed price
 * when set, else the rate card), the hold, whether the nights are taken, a
 * returning guest, the owner's extra details and the WhatsApp reply. One
 * place, used by the web console, the phone app and the Claude connector.
 */

export type Pricer = (row: Enquiry, terms: EnquiryTerms) => QuoteResult & { agreed?: boolean; priceNote?: string | null };

export async function loadPricer(): Promise<Pricer> {
  const plan = await getRatePlan();
  const nightlyRate = (isoDate: string, guests: number) => rateForNight(plan, isoDate, guests);
  const rules = {
    nightPrices: (nights: string[], guests: number) => stayNightPrices(plan, nights, guests),
    minimumStay: (nights: string[]) => minimumStay(plan, nights),
  };
  return (row, terms) => withAgreedPrice(row, quoteForEnquiry(row, nightlyRate, rules), terms);
}

export async function enquiryViews(rows: Enquiry[], now = new Date()) {
  const [price, deadlines, taken, contactList, terms] = await Promise.all([
    loadPricer(),
    holdDeadlinesByEnquiry(),
    listAllEvents().catch(() => []),
    listContacts().catch(() => []),
    termsFor(rows.map((r) => r.id)),
  ]);
  const contacts = new Map(contactList.map((c) => [c.phone, c]));
  const today = todayInIndia(now);

  return rows.map((row) => {
    const rowTerms = terms.get(row.id) ?? NO_TERMS;
    const quote = price(row, rowTerms);
    const datesTaken = datesTakenFor(row, taken);
    const phone = normalisePhone(row.phone);
    const returningGuest = isReturningGuest(phone ? contacts.get(phone) : undefined, today);
    return {
      ...row,
      ...rowTerms,
      quote,
      hold: holdStateOf({ ...row, holdExpiresAt: deadlines.get(row.id) ?? null }, now),
      datesTaken,
      returningGuest,
      /** The WhatsApp reply the console and the app open; written here once. */
      followUpText: buildEnquiryFollowUp(row, { quote, datesTaken, returning: returningGuest, now }),
    };
  });
}
