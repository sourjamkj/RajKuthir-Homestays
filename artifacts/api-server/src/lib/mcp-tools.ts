import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { firstConflict } from "./availability";
import { listPublicBlocks } from "./calendar-repo";
import { bookEnquiryWithDetails, sendEnquiryQuote } from "./enquiry-actions";
import { datesTakenFor } from "./enquiry-clash";
import { saveTerms, termsOf } from "./enquiry-terms";
import { datesProblem, NO_TERMS, parseEnquiryEdit, termsProblem, type EnquiryTerms } from "./enquiry-terms-rules";
import { enquiryViews } from "./enquiry-view";
import { createEnquiry, getEnquiry, listEnquiries, setAdvancePaid, setEnquiryStatus, updateEnquiryFields } from "./enquiries-repo";
import { listAllEvents } from "./calendar-repo";
import { createOrRefreshOnboarding, listAdminGuestStays } from "./guest-onboarding-repo";
import { updateBooking } from "./ledger-repo";
import { SITE_ORIGIN } from "./seo";
import { todayInIndia } from "./guest-lookup";
import { logger } from "./logger";
import { audit } from "./owner-devices";
import { normaliseMobile } from "./phone";
import { randomUUID } from "node:crypto";

import { deleteOverride, getLadder, getPeaks, getRatePlan, saveLadder, savePeaks } from "./rates-repo";
import { ladderTable, nextLadder, nextPeak, peakTable } from "./rate-edit-rules";
import {
  CHILD_UNDER_AGE,
  EXTRA_ADULT_PAISE,
  EXTRA_CHILD_PAISE,
  PET_NIGHTLY_FROM_NIGHTS,
  PET_NIGHTLY_PAISE,
  PET_SHORT_STAY_MULTI_PAISE,
  PET_SHORT_STAY_PAISE,
} from "./party";
import { manualWhatsappLinkFor } from "./mcp-whatsapp";

/**
 * The Claude connector's tools: enquiries, bookings and (since Nov 2026, at
 * the owner's request) the rate card. No settings, money records or phones.
 * Rate tools only preview unless called with apply: true, so the owner sees
 * the old and new prices before anything is saved. Every tool calls the same
 * code and validators as the web console, and every change is written to
 * the console's audit log as "claude".
 */

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const STATUSES = ["new", "contacted", "converted", "closed"] as const;

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 1) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

const rupees = (paise: number | null | undefined) => (paise == null ? null : `₹${Math.round(paise / 100).toLocaleString("en-IN")}`);

/** What Claude is shown of an enquiry: everything useful, money in rupees. */
function compactEnquiry(view: Awaited<ReturnType<typeof enquiryViews>>[number]) {
  const q = view.quote;
  return {
    id: view.id,
    name: view.name,
    phone: view.phone,
    status: view.status,
    checkIn: view.checkIn,
    checkOut: view.checkOut,
    adults: view.adults,
    children: view.children,
    childrenAges: view.childrenAges,
    pets: view.pets,
    requests: view.requests,
    ownerNote: view.ownerNote,
    receivedAt: view.createdAt,
    returningGuest: view.returningGuest,
    datesTaken: view.datesTaken,
    price: q.ok
      ? {
          source: q.agreed ? "agreed by the owner" : "rate card",
          nights: q.nights,
          guests: q.guests,
          total: rupees(q.totalPaise),
          advance: rupees(q.advancePaise),
          balance: rupees(q.balancePaise),
          peak: q.peak,
          priceNote: q.agreed ? q.priceNote ?? null : null,
        }
      : { unavailable: q.reason },
    quoteSentAt: view.quoteSentAt,
    hold: view.hold,
    bookedAs: view.convertedBookingId,
    whatsappReply: view.followUpText,
    whatsappReplyLink: manualWhatsappLinkFor(view.phone, view.followUpText),
  };
}

const detailsShape = {
  name: z.string().min(1).max(200).optional().describe("Guest's name"),
  phone: z.string().max(40).optional().describe("Guest's mobile, e.g. +91 99331 10299"),
  checkIn: ISO.nullable().optional().describe("First night, YYYY-MM-DD"),
  checkOut: ISO.nullable().optional().describe("The day they leave, YYYY-MM-DD"),
  adults: z.number().int().min(0).max(50).nullable().optional(),
  children: z.number().int().min(0).max(50).nullable().optional(),
  childrenAges: z.string().max(100).nullable().optional().describe("e.g. '6 and 9'"),
  pets: z.number().int().min(0).max(10).nullable().optional(),
  requests: z.string().max(1000).nullable().optional().describe("What the guest asked for, in their words"),
  ownerNote: z.string().max(1000).nullable().optional().describe("Private note for the owner; never sent to the guest"),
  agreedTotalRupees: z.number().int().positive().max(10_000_000).nullable().optional().describe("The whole stay at the price the owner agreed; replaces the rate card"),
  agreedAdvanceRupees: z.number().int().positive().max(10_000_000).nullable().optional().describe("Advance to confirm; leave out for the usual share"),
  priceNote: z
    .string()
    .max(600)
    .nullable()
    .optional()
    .describe("How the agreed price is made up, one line per bullet, e.g. '20 and 21 Dec: ₹3,500 a night for 5 guests\n22 Dec: ₹5,000 for 5 guests (Poush Mela week)\n4 more guests with extra bedding: ₹750 each a night'; shown to the guest"),
};

/** Only the keys Claude sent, with null meaning "clear". */
function bodyOf(args: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) if (value !== undefined && key !== "id" && key !== "status") body[key] = value ?? "";
  return body;
}

async function logChange(action: string, detail: Record<string, unknown>) {
  await audit({ via: "claude", deviceId: null, action, detail }).catch(() => undefined);
  logger.info({ action, ...detail }, "Claude connector change");
}

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "raj-kuthir", version: "1.0.0" });

  server.registerTool(
    "check_availability",
    {
      title: "Check availability",
      description:
        "Is Sobuj Potro free for these nights? Checks every channel's bookings and blocks (Booking.com, Airbnb, MakeMyTrip, direct) and quotes currently holding dates. checkOut is the day the guest leaves.",
      inputSchema: { checkIn: ISO, checkOut: ISO },
      annotations: { readOnlyHint: true },
    },
    async ({ checkIn, checkOut }) => {
      if (checkOut <= checkIn) return fail("Check-out must be after check-in.");
      const blocks = await listPublicBlocks();
      const conflict = firstConflict({ startDate: checkIn, endDate: checkOut }, blocks);
      const views = await enquiryViews(await listEnquiries());
      const heldBy = views
        .filter((v) => v.hold.state === "held" && v.checkIn && v.checkOut && v.checkIn < checkOut && v.checkOut > checkIn)
        .map((v) => ({ enquiryId: v.id, name: v.name, checkIn: v.checkIn, checkOut: v.checkOut, hold: v.hold }));
      return json({ checkIn, checkOut, free: !conflict && heldBy.length === 0, takenBy: conflict, heldByQuotes: heldBy });
    },
  );

  server.registerTool(
    "get_rates",
    {
      title: "Rate card",
      description:
        "The live rate card: nightly price by number of guests (weekday and Friday/Saturday), peak periods (with minimum stays and whether the Booking.com rate is entered), and the charges for extra guests past five, children and pets. Money in paise (₹1 = 100 paise).",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const plan = await getRatePlan();
      return json({
        ...plan,
        extras: {
          childUnderAge: CHILD_UNDER_AGE,
          extraAdultPaise: EXTRA_ADULT_PAISE,
          extraChildPaise: EXTRA_CHILD_PAISE,
          petShortStayPaise: PET_SHORT_STAY_PAISE,
          petEachForStayWhenTwoPlusPetsOrTwoNightsPaise: PET_SHORT_STAY_MULTI_PAISE,
          petNightlyPaise: PET_NIGHTLY_PAISE,
          petNightlyFromNights: PET_NIGHTLY_FROM_NIGHTS,
        },
      });
    },
  );

  server.registerTool(
    "list_enquiries",
    {
      title: "List enquiries",
      description:
        "Enquiries, newest first, each with its price (the owner's agreed price when set, else the rate card), hold, whether the dates are taken, and the ready-written WhatsApp reply with a link the owner can tap to send it.",
      inputSchema: {
        status: z.enum(["open", "all", ...STATUSES]).optional().describe("open = new or contacted (default)"),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ status = "open", limit = 30 }) => {
      const rows = (await listEnquiries()).filter((r) =>
        status === "all" ? true : status === "open" ? r.status === "new" || r.status === "contacted" : r.status === status,
      );
      return json((await enquiryViews(rows.slice(0, limit))).map(compactEnquiry));
    },
  );

  server.registerTool(
    "add_enquiry",
    {
      title: "Add an enquiry",
      description:
        "Adds an enquiry the owner received by phone or WhatsApp. Name and phone are required; give everything else you know (dates, adults, children and their ages, pets, the owner's agreed price). Returns the enquiry with its price and the WhatsApp reply. Does not message the guest.",
      inputSchema: { ...detailsShape, name: z.string().min(1).max(200), phone: z.string().min(6).max(40) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      const edit = parseEnquiryEdit(bodyOf(args), normaliseMobile);
      if (!edit.ok) return fail(edit.error);
      const { fields } = edit;
      if (!fields.name || !fields.phone) return fail("Name and phone are required.");
      const terms: EnquiryTerms = { ...NO_TERMS, ...edit.terms };
      const problem = datesProblem(fields.checkIn ?? null, fields.checkOut ?? null) ?? termsProblem(terms);
      if (problem) return fail(problem);
      const created = await createEnquiry({
        name: fields.name,
        phone: fields.phone,
        email: fields.email ?? null,
        checkIn: fields.checkIn ?? null,
        checkOut: fields.checkOut ?? null,
        adults: fields.adults ?? null,
        children: fields.children ?? null,
        pets: fields.pets ?? null,
        requests: fields.requests ?? null,
      });
      if (Object.values(terms).some((v) => v !== null)) await saveTerms(created.id, terms);
      await logChange("enquiry.added", { enquiryId: created.id });
      const [view] = await enquiryViews([created]);
      return json({ added: compactEnquiry(view!), datesTaken: datesTakenFor(created, await listAllEvents().catch(() => [])) });
    },
  );

  server.registerTool(
    "update_enquiry",
    {
      title: "Update an enquiry",
      description:
        "Corrects or completes an enquiry: any of its details, the owner's agreed price, or its status (new, contacted, converted, closed). Only the fields given change; null clears an optional one. Does not message the guest.",
      inputSchema: { id: z.string().uuid(), ...detailsShape, status: z.enum(STATUSES).optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      const existing = await getEnquiry(args.id);
      if (!existing) return fail("That enquiry no longer exists.");
      const edit = parseEnquiryEdit(bodyOf(args), normaliseMobile);
      if (!edit.ok) return fail(edit.error);
      const checkIn = edit.fields.checkIn !== undefined ? edit.fields.checkIn : existing.checkIn;
      const checkOut = edit.fields.checkOut !== undefined ? edit.fields.checkOut : existing.checkOut;
      const terms: EnquiryTerms = { ...(await termsOf(args.id)), ...edit.terms };
      const problem = datesProblem(checkIn, checkOut) ?? termsProblem(terms);
      if (problem) return fail(problem);
      let updated = await updateEnquiryFields(args.id, edit.fields);
      if (Object.keys(edit.terms).length > 0) await saveTerms(args.id, terms);
      if (args.status) updated = await setEnquiryStatus(args.id, args.status);
      if (!updated) return fail("That enquiry no longer exists.");
      await logChange("enquiry.updated", { enquiryId: args.id, fields: Object.keys(bodyOf(args)), status: args.status ?? null });
      const [view] = await enquiryViews([updated]);
      return json(compactEnquiry(view!));
    },
  );

  server.registerTool(
    "send_quote",
    {
      title: "Send the quote",
      description:
        "Prepares the quote with the UPI payment details (the agreed price when set) and starts the 24-hour hold on the dates. With WhatsApp Business off (as now) nothing reaches the guest until the owner taps the returned whatsappUrl and presses send; say so to the owner. Re-sending is allowed.",
      inputSchema: { id: z.string().uuid() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ id }) => {
      const result = await sendEnquiryQuote(id);
      if (!result.ok) return fail(String(result.body.error ?? "The quote could not be prepared."));
      await logChange("enquiry.quote", { enquiryId: id, delivery: result.body.delivery });
      return json({
        delivery: result.body.delivery,
        whatsappUrl: result.body.whatsappUrl,
        message: result.body.preview,
        total: rupees(result.body.quote.totalPaise),
        advance: rupees(result.body.quote.advancePaise),
      });
    },
  );

  server.registerTool(
    "set_advance_received",
    {
      title: "Mark the advance received",
      description:
        "Records that the guest's advance reached the owner's bank (only after the owner has seen it), which keeps the quoted dates held. received=false undoes it.",
      inputSchema: { id: z.string().uuid(), received: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, received }) => {
      const updated = await setAdvancePaid(id, received);
      if (!updated) return fail("That enquiry no longer exists.");
      await logChange("enquiry.advance", { enquiryId: id, received });
      const [view] = await enquiryViews([updated]);
      return json(compactEnquiry(view!));
    },
  );

  server.registerTool(
    "book_enquiry",
    {
      title: "Create the booking",
      description:
        "Turns an enquiry into a confirmed booking with the owner's details: dates, adults, children, pets, the total agreed for the stay and the advance received (rupees). Issues the RK- reference, blocks the dates on every channel's calendar and sends the guest the booking confirmation. Only when the owner has said to book it.",
      inputSchema: {
        id: z.string().uuid(),
        checkIn: ISO,
        checkOut: ISO,
        adults: z.number().int().min(1).max(20),
        children: z.number().int().min(0).max(20),
        pets: z.number().int().min(0).max(10),
        totalRupees: z.number().int().positive().max(10_000_000),
        advanceRupees: z.number().int().min(0).max(10_000_000),
        confirmWithoutAdvance: z.boolean().optional().describe("Needed when advanceRupees is 0"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ id, ...details }) => {
      const result = await bookEnquiryWithDetails(id, details);
      if (!result.ok) return fail(String(result.body.error ?? "The booking could not be created."));
      await logChange("enquiry.booked", { enquiryId: id, bookingId: result.body.booking.id });
      return json(result.body);
    },
  );

  server.registerTool(
    "list_bookings",
    {
      title: "List bookings",
      description:
        "Bookings from every channel with guest, dates, party, channel, status, money (paise) and the guest's ID verification. upcomingOnly (default true) leaves out stays that have ended.",
      inputSchema: { upcomingOnly: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ upcomingOnly = true }) => {
      const today = todayInIndia(new Date());
      const stays = (await listAdminGuestStays())
        .filter((s) => !upcomingOnly || s.checkOut > today)
        .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
        .map(({ onboardingId: _id, ...s }) => s);
      return json(stays);
    },
  );

  const APPLY = z.boolean().optional().describe("false or left out: preview only (old and new prices). true: save it. Show the owner the preview first.");
  const preview = (before: unknown, after: unknown, extra: Record<string, unknown> = {}) =>
    json({ saved: false, note: "Preview only. Nothing has changed. Call again with apply: true to save.", before, after, ...extra });

  server.registerTool(
    "set_rate_ladder",
    {
      title: "Set the normal-night rates",
      description:
        "Changes the website's normal-night rate ladder: weekday (Sun–Thu) and Fri–Sat price for 1–2 guests, the charge per extra guest for the 3rd–5th, the floor, and the weekly discount. Rupees. Only the fields given change. Returns old and new prices by party size; saves only with apply: true.",
      inputSchema: {
        weekdayBaseRupees: z.number().int().positive().optional(),
        weekendBaseRupees: z.number().int().positive().optional(),
        extraGuestRupees: z.number().int().min(0).optional(),
        floorRupees: z.number().int().positive().optional(),
        weeklyDiscountPercent: z.number().int().min(0).max(50).optional(),
        apply: APPLY,
      },
    },
    async ({ apply, ...args }) => {
      const current = await getLadder();
      const next = nextLadder(current, args);
      if (!next.ok) return fail(next.error);
      if (!apply) return preview(ladderTable(current), ladderTable(next.ladder));
      await saveLadder(next.ladder);
      await logChange("rates.ladder", { before: current, after: next.ladder });
      return json({ saved: true, now: ladderTable(next.ladder) });
    },
  );

  server.registerTool(
    "set_peak_period",
    {
      title: "Add or change a peak period",
      description:
        "Adds a peak period (give label, firstNight, lastNight) or changes one (give its id from get_rates). Nights are inclusive. Price it with priceFor5GuestsRupees (the direct price for 5 guests; smaller parties step down by the usual extra-guest charge) or with bookingComRupees and discountPercent. minNights is the minimum stay. Returns old and new prices; saves only with apply: true.",
      inputSchema: {
        id: z.string().max(80).optional(),
        label: z.string().max(120).optional(),
        firstNight: ISO.optional(),
        lastNight: ISO.optional(),
        priceFor5GuestsRupees: z.number().int().positive().optional(),
        bookingComRupees: z.number().int().positive().optional(),
        discountPercent: z.number().int().min(0).max(90).optional(),
        minNights: z.number().int().min(1).max(14).optional(),
        apply: APPLY,
      },
    },
    async ({ id, apply, ...args }) => {
      const [peaks, ladder] = await Promise.all([getPeaks(), getLadder()]);
      const existing = id ? peaks.find((p) => p.id === id) ?? null : null;
      if (id && !existing) return fail("No peak period has that id. get_rates lists them.");
      const next = nextPeak(existing, args, ladder, existing?.id ?? randomUUID());
      if (!next.ok) return fail(next.error);
      const after = peakTable(next.peak, ladder);
      const before = existing ? peakTable(existing, ladder) : "new peak period";
      if (!apply) return preview(before, after);
      await savePeaks(existing ? peaks.map((p) => (p.id === existing.id ? next.peak : p)) : [...peaks, next.peak]);
      await logChange(existing ? "rates.peak.changed" : "rates.peak.added", { before: existing, after: next.peak });
      return json({ saved: true, now: after });
    },
  );

  server.registerTool(
    "remove_peak_period",
    {
      title: "Remove a peak period",
      description: "Removes a peak period by id (from get_rates); its nights go back to normal-night rates. Previews unless apply: true.",
      inputSchema: { id: z.string().max(80), apply: APPLY },
    },
    async ({ id, apply }) => {
      const [peaks, ladder] = await Promise.all([getPeaks(), getLadder()]);
      const existing = peaks.find((p) => p.id === id);
      if (!existing) return fail("No peak period has that id. get_rates lists them.");
      if (!apply) return preview(peakTable(existing, ladder), "removed: these nights use normal-night rates");
      await savePeaks(peaks.filter((p) => p.id !== id));
      await logChange("rates.peak.removed", { before: existing });
      return json({ saved: true, removed: existing.label });
    },
  );

  server.registerTool(
    "remove_rate_rule",
    {
      title: "Remove a date rule",
      description:
        "Removes one of the older date rules (the overrides in get_rates, e.g. a +40% New Year rule) by id. Previews unless apply: true.",
      inputSchema: { id: z.string().uuid(), apply: APPLY },
    },
    async ({ id, apply }) => {
      const plan = await getRatePlan();
      const rule = plan.overrides.find((o) => o.id === id);
      if (!rule) return fail("No date rule has that id. get_rates lists them.");
      const shown = { label: rule.label, from: rule.startDate, until: rule.endDate, mode: rule.mode, percent: rule.effectivePercent ?? null };
      if (!apply) return preview(shown, "removed");
      if (!(await deleteOverride(id))) return fail("That rule was already removed.");
      await logChange("rates.rule.removed", { rule: shown, id });
      return json({ saved: true, removed: shown });
    },
  );

  server.registerTool(
    "prepare_guest_arrival",
    {
      title: "Add a guest's phone and get their ID-upload link",
      description:
        "For a booking (id from list_bookings), typically an Airbnb, Booking.com or MakeMyTrip stay whose phone the channel hid: saves the guest's mobile if given, and issues (or refreshes) their pre-arrival ID-upload link. Returns the link, the verification deadline and a WhatsApp message with a tap-to-send link. Does not message the guest.",
      inputSchema: {
        bookingId: z.string().uuid(),
        phone: z.string().max(40).optional().describe("Guest's mobile, e.g. +91 90077 18052"),
      },
    },
    async ({ bookingId, phone }) => {
      let mobile: string | null = null;
      if (phone) {
        mobile = normaliseMobile(phone);
        if (!mobile) return fail("That does not look like a mobile number we can reach.");
        const updated = await updateBooking(bookingId, { guestPhone: mobile });
        if (!updated) return fail("No booking has that id. list_bookings shows them.");
      }
      const onboarding = await createOrRefreshOnboarding(bookingId);
      if (!onboarding) return fail("No booking has that id. list_bookings shows them.");
      const url = `${SITE_ORIGIN}/pre-arrival#${encodeURIComponent(onboarding.token)}`;
      const first = (onboarding.booking.guestName ?? "").trim().split(/\s+/)[0] || "there";
      const text =
        `Hi ${first}, to keep your check-in quick, please upload a photo ID for each adult here before you arrive:\n${url}\n\n` +
        `It takes two minutes. Warm regards,\nTeam Raj Kuthir Homestays – Sobuj Potro`;
      const to = onboarding.booking.guestPhone ?? mobile;
      await logChange("booking.arrival_prepared", { bookingId, phoneSaved: Boolean(mobile) });
      return json({
        guest: onboarding.booking.guestName,
        phone: to,
        preArrivalLink: url,
        verificationDeadline: onboarding.verificationDeadline,
        whatsappText: text,
        whatsappLink: to ? manualWhatsappLinkFor(to, text) : null,
      });
    },
  );

  return server;
}
