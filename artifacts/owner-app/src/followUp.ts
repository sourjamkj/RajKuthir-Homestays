/**
 * The WhatsApp follow-up for an enquiry. The server writes it
 * (api-server lib/enquiry-followup.ts, the same text the web console opens):
 * the price when dates and party are known, a welcome back for a returning
 * guest. The builder below is only the fallback for an older server.
 */
import { manualWhatsappLink, SITE, type Enquiry } from './api';
import { shortDate } from './theme';

export function buildEnquiryFollowUp(row: Enquiry, now = Date.now()): string {
  const first = row.name.trim().split(/\s+/)[0] || 'there';
  const dates = row.checkIn && row.checkOut ? `${shortDate(row.checkIn)} – ${shortDate(row.checkOut)}` : null;
  const sign = '\n\nWarm regards,\nTeam Raj Kuthir Homestays – Sobuj Potro';

  if (row.datesTaken && dates) {
    return (
      `Hi ${first}, thank you for your interest in Raj Kuthir Homestays – Sobuj Potro, Shantiniketan.\n\n` +
      `I'm sorry, the villa is already booked for ${dates}. ` +
      `If your dates are flexible, I'd be glad to host you on another day. Share the dates that suit you and I will send you the best direct rate.\n\n` +
      `See which dates are open: ${SITE}/#availability${sign}`
    );
  }

  if (row.status === 'contacted') {
    if (row.quoteSentAt) {
      return (
        `Hi ${first}, just following up on the quote we sent${dates ? ` for ${dates}` : ''}. ` +
        `Happy to answer any questions or adjust the dates. Shall I confirm it for you?${sign}`
      );
    }
    return (
      `Hi ${first}, just checking in — happy to hold dates for you if you are still thinking about ` +
      `Shantiniketan this season. Send me your dates whenever you are ready 🙂${sign}`
    );
  }

  const waited = now - new Date(row.createdAt).getTime() > 24 * 60 * 60 * 1000;
  const ask = dates
    ? `You had asked about ${dates}. Let me know if those dates still work and how many of you are coming, and I will send you the best direct rate.`
    : `Are you still planning a trip? Share your dates and number of guests, and I will check availability and send you the best direct rate.`;
  return (
    `Hi ${first}, this is Raj Kuthir Homestays – Sobuj Potro, Shantiniketan. ` +
    `Thank you for getting in touch${waited ? ' — and sorry we did not get back sooner' : ''}!\n\n` +
    `${ask}\n\n` +
    `• The entire 2-bedroom villa is yours: 2 AC bedrooms, private garden, parking, Wi-Fi\n` +
    `• Pets welcome\n` +
    `• Booking direct costs less than the booking apps\n` +
    `• Food: Cafe Soi in the villa grounds serves breakfast, Bengali home cooking, tea and snacks (menu: ${SITE}/cafe-soi-shantiniketan). Home-cooked meals can also be arranged with the caretaker.\n` +
    `• Photos: ${SITE}/gallery\n` +
    `• Rates: ${SITE}/rates\n` +
    `• Live availability: ${SITE}/#availability${sign}`
  );
}

export function followUpLink(row: Enquiry): string {
  const digits = row.phone.replace(/\D/g, '');
  const to = digits.length === 10 ? `91${digits}` : digits;
  return manualWhatsappLink(to, row.followUpText ?? buildEnquiryFollowUp(row));
}
