import { normalisePhone, type Enquiry } from "@workspace/db";

import { holdDeadlinesByEnquiry } from "./book-pay-repo";
import { listAllEvents } from "./calendar-repo";
import { datesTakenFor } from "./enquiry-clash";
import { buildEnquiryFollowUp, isReturningGuest } from "./enquiry-followup";
import { holdStateOf } from "./enquiry-hold";
import { quoteForEnquiry, type QuoteResult } from "./enquiry-quote";
import { offerUrl } from "./enquiry-offer-rules";
import { offerTokensFor } from "./enquiry-offers";
import { SITE } from "./enquiry-followup";
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

  const priced = rows.map((row) => {
    const rowTerms = terms.get(row.id) ?? NO_TERMS;
    return { row, rowTerms, quote: price(row, rowTerms) };
  });
  // A ready-to-pay link for every open enquiry that has a price.
  const offerable = priced
    .filter(({ row, quote }) => quote.ok && (row.status === "new" || row.status === "contacted") && !!row.checkIn && row.checkIn >= today)
    .map(({ row }) => row.id);
  const offers = await offerTokensFor(offerable);

  return priced.map(({ row, rowTerms, quote }) => {
    const token = offers.get(row.id);
    const offer = token ? offerUrl(SITE, token) : null;
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
      followUpText: buildEnquiryFollowUp(row, { quote, datesTaken, returning: returningGuest, now, offerUrl: offer }),
      /** The guest's ready-to-pay link, dates and price filled in. */
      offerUrl: offer,
    };
  });
}
