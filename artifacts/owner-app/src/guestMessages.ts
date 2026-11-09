/**
 * The WhatsApp messages sent from Guests: the booking confirmation with the
 * verification link, the check-in details, the management handoff and the
 * review ask. Word for word the same as the web console's Guests page
 * (raj-kuthir/src/pages/AdminGuests.tsx); change both together.
 */
import { SOURCE_LABELS, type ArrivalInfo, type GuestStay, type ManagementGuestVerification } from './api';

export const HOST_PHONE = '+91 62903 99165';
export const CARETAKER_PHONE = '+91 78726 85558';
export const LEAVE_REVIEW_URL = 'https://g.page/r/CR9H9DboJM75EBM/review';
export const MAPS_URL = 'https://maps.app.goo.gl/aEdaJaaeEy1DZ8Ps8?g_st=ac';
/** The management handoff goes to the host's own WhatsApp, as on the web. */
export const MANAGEMENT_WHATSAPP = HOST_PHONE.replace(/\D/g, '');
/** Attached by hand to the check-in chat (a wa.me link carries text only). */
export const HOUSE_RULES_PDF = 'https://rajkuthirhomestays.casa/raj-kuthir-house-rules.pdf';

const CHECK_IN_TIME = '12:00 PM';
const CHECK_OUT_TIME = '11:00 AM';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Stored numbers are often the bare 10 digits; wa.me needs the country code. */
export function waNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '').replace(/^0+/, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

export const waUrl = (phone: string, text: string) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;

/** The plain hello from the guest list and the enquiry card. */
export const helloText = (name: string | null) =>
  `Hello ${name ?? ''}, this is Raj Kuthir Homestays – Sobuj Potro.`.replace(/\s+/g, ' ');

/** "6 November 2026 (Friday)" */
export function prettyGuestDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()];
  return `${d} ${MONTHS[m! - 1]} ${y} (${weekday})`;
}

export function todayInIndia(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.max(0, Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400000));
}

function money(paise: number | null): string {
  if (paise == null) return 'To be confirmed';
  return Math.round(paise / 100).toLocaleString('en-IN');
}

/**
 * Channels where the guest pays the full price to the channel at booking:
 * gross minus what reached us is the channel's commission, never the guest's.
 */
const PREPAID_CHANNELS = new Set<string>(['airbnb', 'makeMyTrip']);

export function guestBalancePaise(stay: GuestStay): number | null {
  if (PREPAID_CHANNELS.has(stay.source)) return 0;
  if (stay.grossPaise == null || stay.receivedPaise == null) return null;
  return Math.max(0, stay.grossPaise - stay.receivedPaise);
}

export function buildGuestWhatsAppMessage(stay: GuestStay, verificationUrl: string): string {
  const nights = nightsBetween(stay.checkIn, stay.checkOut);
  const total = money(stay.grossPaise);
  const advance = money(stay.receivedPaise);
  const due = guestBalancePaise(stay);
  const balance = due != null ? money(due) : 'To be confirmed';
  const paymentLines = PREPAID_CHANNELS.has(stay.source)
    ? `- Paid in full via ${SOURCE_LABELS[stay.source] ?? stay.source} ✅\n- Nothing further is due for the booking`
    : `- Total Booking Amount: ₹${total}\n- Advance Received: ₹${advance} ✅\n- Balance Amount Due: ₹${balance} (Payable at the property during check-in)`;
  return `Greetings from Raj Kuthir Homestays – Sobuj Potro, Shantiniketan! 🌿\n\nDear ${stay.guestName ?? 'Guest'},\n\nThank you for choosing Raj Kuthir Homestays – Sobuj Potro. We are pleased to confirm your booking.\n\n🔴 IMPORTANT – ACTION REQUIRED BEFORE ARRIVAL\n\n📄 Document Verification / Pre-Arrival Check-in:\n${verificationUrl}\n\nPlease complete the mandatory guest information and ID document verification at least 48 hours before your scheduled check-in time.\n\n⚠️ Failure to complete the mandatory verification within this timeframe may result in check-in being denied without refund, in accordance with the booking terms.\n\n📅 Check-in: ${prettyGuestDate(stay.checkIn)} – ${CHECK_IN_TIME} onwards\n📅 Check-out: ${prettyGuestDate(stay.checkOut)} – ${CHECK_OUT_TIME}\n👥 Guests: ${stay.guests ?? 'As booked'}\n🏡 Accommodation: Entire Two-Bedroom Villa${nights ? ` (${nights} Nights)` : ''}${stay.pets ? `\n🐾 Pets: ${stay.pets}` : ''}\n\n💰 Booking Details\n\n${paymentLines}\n- Refundable security deposit: ₹2,500, paid at check-in and returned at check-out\n\n📍 Google Maps: ${MAPS_URL}\n\n📞 Contact Numbers\n- Host: +91 62903 99165\n- Designated Caretaker: +91 78726 85558\n\nAdditional Information\n\n- High-speed Wi-Fi is available and suitable for work/staycations.\n- Cafe Soi, located within the premises, serves snacks and beverages.\n- Home-cooked meals can also be arranged after discussing the menu and charges directly with the caretaker.\n- Zomato is available in the area with multiple restaurant options. Delivery availability and timings may vary depending on weather and local conditions.\n- Basic cooking utensils are available for simple meals. Additional utensils for elaborate cooking can be arranged subject to availability. Guests are also welcome to bring their own induction/microwave-compatible cookware if required.\n\nWe look forward to hosting you and wish you a wonderful stay at Raj Kuthir Homestays – Sobuj Potro.\n\nWarm regards,\nTeam Raj Kuthir Homestays – Sobuj Potro`;
}

/** Tap-to-fill reasons on the reject box. Mirrors api-server document-rejection-rules.ts. */
export const COMMON_REJECTION_REASONS = [
  'The photo is blurred or too dark to read',
  'Part of the ID is cut off; all four corners must be visible',
  'The back side of the ID is missing',
  'The ID has expired',
  'The name on the ID does not match the guest',
  'This is not an accepted photo ID',
  'IDs are missing for some guests in the group',
];

/** What the guest must do to upload again. Mirrors UPLOAD_INSTRUCTIONS on the server. */
export const UPLOAD_INSTRUCTIONS = [
  'One photo ID for every guest, children included. Adults: Aadhaar, passport, driving licence or voter ID. Children: Aadhaar, passport, school ID or birth certificate',
  'Front and back, where the ID has two sides',
  'A clear, well-lit photo or scan with all four corners visible, no blur or glare',
  'The name must match the guest, and the ID must not be expired',
  'Foreign nationals: the passport photo page and the Indian visa',
  'A camera photo, or a PDF under 4 MB. Photos are made smaller automatically',
  'Fill one card per guest on the upload page, with the name as it is on the ID',
];

/** "11 November 2026, 12:00 PM" in India time, without relying on Intl time zones. */
function prettyDeadline(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(new Date(iso).getTime() + 330 * 60_000);
  if (Number.isNaN(at.getTime())) return null;
  const h = at.getUTCHours();
  const mm = String(at.getUTCMinutes()).padStart(2, '0');
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}, ${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Sent when the owner rejects an ID upload, in place of the booking message:
 * the reason, the fresh link, and exactly how to upload again.
 */
export function buildDocumentsRejectedMessage(stay: GuestStay, reason: string, verificationUrl: string, deadline?: string | null): string {
  const first = (stay.guestName ?? '').trim().split(/\s+/)[0] || 'there';
  const by = prettyDeadline(deadline);
  return [
    `Hello ${first} 🌿`,
    '',
    `Thank you for uploading your ID for your stay at Raj Kuthir Homestays – Sobuj Potro (${prettyGuestDate(stay.checkIn)} to ${prettyGuestDate(stay.checkOut)}). Unfortunately we could not accept it.`,
    '',
    `❌ Reason: ${reason.trim()}`,
    '',
    `📄 Please upload again here:`,
    verificationUrl,
    '',
    `✅ How to upload`,
    ...UPLOAD_INSTRUCTIONS.map((line) => `• ${line}`),
    '',
    `⏰ Please complete this${by ? ` by ${by}` : ''}, at least 48 hours before check-in. Without verified IDs, check-in may be denied as per the booking terms.`,
    '',
    `Need help? Call or WhatsApp ${HOST_PHONE}.`,
    '',
    `Warm regards,`,
    `Team Raj Kuthir Homestays – Sobuj Potro`,
  ].join('\n');
}

const ID_LABELS: Record<string, string> = { aadhaar: 'Aadhaar', passport: 'Passport', dl: 'Driving licence', voter: 'Voter ID', school: 'School ID', birth: 'Birth certificate' };
export const idTypeLabel = (key: string | null | undefined) => (key && ID_LABELS[key]) || 'ID';

/** One group per guest for the owner's review; `slot: null` is an earlier, ungrouped upload. */
export function groupByGuest<T extends { guest?: { slot: number; name: string; age: string; idType: string } | null; status: string; rejectionReason: string | null }>(docs: T[]) {
  const groups = new Map<number | null, { slot: number | null; name: string | null; idType: string | null; age: string | null; docs: T[]; rejected: boolean; reason: string | null }>();
  for (const doc of docs) {
    const key = doc.guest?.slot ?? null;
    const group = groups.get(key) ?? { slot: key, name: doc.guest?.name ?? null, idType: doc.guest?.idType ?? null, age: doc.guest?.age ?? null, docs: [], rejected: false, reason: null };
    group.docs.push(doc);
    if (doc.status === 'rejected') { group.rejected = true; group.reason = group.reason ?? doc.rejectionReason; }
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
}

/**
 * Sent when the owner rejects one or more guests' IDs: names each guest and
 * what to fix, says the others are accepted, and gives the link and checklist.
 */
export function buildGuestIdsRejectedMessage(stay: GuestStay, rejected: Array<{ slot: number; name: string; reason: string }>, acceptedNames: string[], verificationUrl: string, deadline?: string | null): string {
  const first = (stay.guestName ?? '').trim().split(/\s+/)[0] || 'there';
  const by = prettyDeadline(deadline);
  return [
    `Hello ${first} 🌿`,
    '',
    `Thank you for uploading the IDs for your stay at Raj Kuthir Homestays – Sobuj Potro (${prettyGuestDate(stay.checkIn)} to ${prettyGuestDate(stay.checkOut)}). ${rejected.length === 1 ? 'One ID needs' : 'These IDs need'} to be uploaded again:`,
    '',
    ...rejected.map((r) => `❌ Guest ${r.slot} (${r.name}) – Reason: ${r.reason}`),
    ...(acceptedNames.length ? ['', `✅ Accepted, nothing more needed: ${acceptedNames.join(', ')}`] : []),
    '',
    `📄 Re-upload ${rejected.length === 1 ? 'that ID' : 'those IDs'} here (the accepted guests are already done):`,
    verificationUrl,
    '',
    `✅ How to upload`,
    ...UPLOAD_INSTRUCTIONS.map((line) => `• ${line}`),
    '',
    `⏰ Please complete this${by ? ` by ${by}` : ''}, at least 48 hours before check-in. Without verified IDs, check-in may be denied as per the booking terms.`,
    '',
    `Need help? Call or WhatsApp ${HOST_PHONE}.`,
    '',
    `Warm regards,`,
    `Team Raj Kuthir Homestays – Sobuj Potro`,
  ].join('\n');
}

/** Sent once verification is complete, in place of the documents message. */
export function buildCheckinWhatsAppMessage(stay: GuestStay, info: ArrivalInfo | null): string {
  const first = (stay.guestName ?? '').trim().split(/\s+/)[0] || 'there';
  const nights = nightsBetween(stay.checkIn, stay.checkOut);
  const balancePaise = guestBalancePaise(stay);

  const wifi =
    info && (info.wifiSsid || info.wifiPassword)
      ? ['', `📶 Wi-Fi`, ...(info.wifiSsid ? [`- Network: ${info.wifiSsid}`] : []), ...(info.wifiPassword ? [`- Password: ${info.wifiPassword}`] : [])]
      : [];

  const arrival = info?.arrival.trim() ? ['', `🧭 Arriving at the villa`, info.arrival.trim()] : [];

  const contacts =
    info && info.contacts.length > 0
      ? info.contacts.map((c) => `- ${c.label || 'Contact'}${c.name ? ` (${c.name})` : ''}: ${c.phone}`)
      : [`- Caretaker (arrival, meals, local help): ${CARETAKER_PHONE}`, `- Host: ${HOST_PHONE}`];

  return [
    `Hello ${first} 🌿`,
    '',
    `Thank you — your verification is complete and you are all set for your stay at Raj Kuthir Homestays – Sobuj Potro.`,
    '',
    `📅 Check-in: ${prettyGuestDate(stay.checkIn)} – ${CHECK_IN_TIME} onwards`,
    `📅 Check-out: ${prettyGuestDate(stay.checkOut)} – ${CHECK_OUT_TIME}`,
    `🏡 Entire Two-Bedroom Villa${nights ? ` (${nights} Night${nights === 1 ? '' : 's'})` : ''}`,
    `👥 Guests: ${stay.guests ?? 'As booked'}${stay.pets ? ` · 🐾 Pets: ${stay.pets}` : ''}`,
    ...(stay.reference ? [`🔖 Booking reference: ${stay.reference}`] : []),
    '',
    `📍 Google Maps: ${MAPS_URL}`,
    ...arrival,
    ...wifi,
    ...(balancePaise && balancePaise > 0 ? ['', `💰 Balance payable at check-in: ₹${money(balancePaise)}`] : []),
    '',
    `🔐 Refundable security deposit: ₹2,500, paid at check-in and returned at check-out`,
    '',
    `📞 Who to call`,
    ...contacts,
    `Do let the caretaker know your expected arrival time so the house is ready for you.`,
    '',
    `📋 Our house rules are attached to this chat as a PDF.`,
    '',
    `Safe travels — we look forward to welcoming you.`,
    '',
    `Warm regards,`,
    `Team Raj Kuthir Homestays – Sobuj Potro`,
  ].join('\n');
}

/** Takes only the money-free management view, so no amount can slip in. */
export function buildManagementMessage(dto: ManagementGuestVerification, managementUrl: string): string {
  const plural = (n: number) => `${n} ID document${n === 1 ? '' : 's'}`;
  const docs = [
    ...(dto.documents.verified ? [`${plural(dto.documents.verified)} — Verified`] : []),
    ...(dto.documents.submitted ? [`${plural(dto.documents.submitted)} — Uploaded / Pending verification`] : []),
    ...(dto.documents.rejected ? [`${plural(dto.documents.rejected)} — Rejected`] : []),
  ];
  const READINESS: Record<ManagementGuestVerification['readiness'], string> = {
    ready: 'Ready for check-in — all documents verified',
    documents_submitted: 'Documents uploaded — awaiting verification',
    awaiting_documents: 'Awaiting guest documents',
    deadline_passed: 'Verification deadline passed — property to decide on check-in',
    blocked: 'Check-in blocked — property to decide',
  };
  return [
    'SOBUJ POTRO — GUEST ARRIVAL / VERIFICATION',
    '',
    `Guest: ${dto.guestName ?? 'Not provided'}`,
    `Number: ${dto.guestPhone ?? 'Not provided'}`,
    `Check-in: ${prettyGuestDate(dto.checkIn)}`,
    `Check-out: ${prettyGuestDate(dto.checkOut)}`,
    '',
    'Guest ID documents:',
    ...(docs.length ? docs.map((doc, i) => `${i + 1}. ${doc}`) : ['1. No documents uploaded yet']),
    '',
    `Status: ${READINESS[dto.readiness]}`,
    '',
    'Secure document access:',
    managementUrl,
  ].join('\n');
}

export const managementSubject = (dto: ManagementGuestVerification) =>
  `Sobuj Potro — Guest Arrival / Verification — ${dto.guestName ?? 'Guest'}`;

/** From the day after check-in, for a stay that is not cancelled. */
export function canAskForReview(stay: GuestStay): boolean {
  return stay.status !== 'cancelled' && stay.checkIn < todayInIndia();
}

/** Same variants as the review queue: in-house, pets, one night, else general. */
export function buildReviewMessage(stay: GuestStay): string {
  const first = (stay.guestName ?? '').trim().split(/\s+/)[0] || 'there';
  const url = LEAVE_REVIEW_URL;
  const lines = (...paragraphs: string[]) =>
    [...paragraphs, 'Warm Regards,\nSourja Mukherjee\nRaj Kuthir Homestays – Sobuj Potro'].join('\n\n');
  if (stay.checkOut > todayInIndia()) {
    return lines(
      `Hello ${first},`,
      `We hope you are enjoying your stay at Sobuj Potro. Whenever you have a minute, a short Google review would mean a lot and helps other travellers find us:\n${url}`,
    );
  }
  if ((stay.pets ?? 0) > 0) {
    return lines(
      `Hi ${first},`,
      `It was a pleasure hosting you and your pet at Raj Kuthir Homestays – Sobuj Potro. We hope the drive home was smooth.`,
      `Finding a genuinely pet-friendly stay in Bolpur is hard for many pet parents, so your review would help them a lot:\n${url}`,
      `Feel free to mention how your pet took to the garden.`,
    );
  }
  if (nightsBetween(stay.checkIn, stay.checkOut) === 1) {
    return lines(
      `Namaskar ${first},`,
      `Thank you for choosing Raj Kuthir Homestays – Sobuj Potro for your Santiniketan getaway.`,
      `Could you share a quick Google review of your stay?\n${url}`,
      `Your favourite part, in a line, helps other travellers find us on Google Maps.`,
    );
  }
  return lines(
    `Hi ${first},`,
    `Thank you for staying with us at Raj Kuthir Homestays – Sobuj Potro. We hope you reached home safely and enjoyed your time in Santiniketan.`,
    `Google reviews help other travellers find our private 2-bedroom villa. If you have a minute, we'd really appreciate a few words about your stay:\n${url}`,
    `Even a line about what you liked most helps future guests know what to expect.`,
  );
}

/* ------------------------------------------------------------ sorting */

export type StaySortKey = 'guest' | 'stay' | 'booked' | 'verification' | 'documents';
export const STAY_SORTS: Array<{ key: StaySortKey; label: string; first: 'asc' | 'desc' }> = [
  { key: 'stay', label: 'Stay', first: 'asc' },
  { key: 'guest', label: 'Guest', first: 'asc' },
  { key: 'booked', label: 'Booked', first: 'desc' },
  { key: 'verification', label: 'Verification', first: 'asc' },
  { key: 'documents', label: 'Documents', first: 'desc' },
];

function verificationRank(stay: GuestStay): number {
  const verified = stay.onboardingStatus === 'verified';
  const deadlinePassed = Boolean(stay.verificationDeadline && new Date(stay.verificationDeadline).getTime() <= Date.now() && !verified);
  if (deadlinePassed) return 0;
  if (stay.onboardingStatus === 'submitted') return 1;
  if (!verified) return 2;
  return 3;
}

function stayValue(stay: GuestStay, key: StaySortKey): string | number {
  switch (key) {
    case 'guest':
      return (stay.guestName ?? '').trim().toLowerCase() || '￿';
    case 'stay':
      return stay.checkIn;
    case 'booked':
      return stay.createdAt;
    case 'verification':
      return verificationRank(stay);
    case 'documents':
      return stay.documents.verified + stay.documents.submitted + stay.documents.rejected + stay.documents.pending;
  }
}

/** 0 = upcoming or in the house now, 1 = already left, 2 = cancelled. */
function stayPhase(stay: GuestStay, today: string): number {
  if (stay.status === 'cancelled') return 2;
  return stay.checkOut > today ? 0 : 1;
}

/** Default (Stay, ascending): upcoming soonest first, then past most recent first, cancelled last. */
export function sortStays(stays: GuestStay[], key: StaySortKey, dir: 'asc' | 'desc'): GuestStay[] {
  if (key === 'stay' && dir === 'asc') {
    const today = todayInIndia();
    return [...stays].sort((a, b) => {
      const phase = stayPhase(a, today) - stayPhase(b, today);
      if (phase !== 0) return phase;
      const byDate = a.checkIn.localeCompare(b.checkIn);
      return stayPhase(a, today) === 0 ? byDate : -byDate;
    });
  }
  const sign = dir === 'asc' ? 1 : -1;
  return [...stays].sort((a, b) => {
    const x = stayValue(a, key);
    const y = stayValue(b, key);
    if (x < y) return -sign;
    if (x > y) return sign;
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  });
}
