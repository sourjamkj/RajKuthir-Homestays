import type { RatePlan } from "./rates-repo.ts";

/** rates-repo's rateForNight, passed in so this file stays free of the database. */
export type NightPrice = (plan: RatePlan, isoDate: string, guests: number) => number;

/**
 * The prerendered pages show a "loading" line where the live rates go, and a
 * crawler that runs no JavaScript (Google's first pass, ChatGPT, Perplexity)
 * reads only that line. These build the same facts as plain text, and
 * `withRateFacts` swaps them into the HTML before it is sent. The page's own
 * script still replaces them with the full rate card once it loads.
 */
export const RATES_PLACEHOLDER = "Loading the current rate card…";
export const FESTIVAL_PLACEHOLDER = "Reading this year’s dates and rates…";

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const day = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** "₹2,900 a night for 1–2 guests, ₹3,100 for 3 …", weekend shown only when it differs. */
export function ratesLine(plan: RatePlan): string {
  const part = (rates: Record<number, number>) => {
    const out: string[] = [];
    for (let g = 1; g <= plan.maxGuests; g += 1) {
      const from = g;
      while (g < plan.maxGuests && rates[g + 1] === rates[from]) g += 1;
      out.push(`${rupees(rates[from]!)} for ${from === g ? from : `${from}–${g}`} guest${g === 1 ? "" : "s"}`);
    }
    return out.join(", ");
  };
  const same = Object.keys(plan.rates).every((g) => plan.rates[+g] === plan.weekendRates[+g]);
  return same
    ? `Whole villa, per night, every night of the week: ${part(plan.rates)}. Festival weeks are priced separately.`
    : `Whole villa, per night. Sunday to Thursday: ${part(plan.rates)}. Friday and Saturday: ${part(plan.weekendRates)}. Festival weeks are priced separately.`;
}

/** The next peak whose id starts with `peakId`: its nights, minimum stay and price for two. */
export function festivalLine(plan: RatePlan, peakId: string, today: string, rateForNight: NightPrice): string | null {
  const peak = plan.peaks
    .filter((p) => p.id.startsWith(peakId))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .find((p) => p.endDate > today);
  if (!peak) return null;
  const prices: number[] = [];
  for (let night = peak.startDate; night < peak.endDate; night = addDays(night, 1)) prices.push(rateForNight(plan, night, 2));
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const top = rateForNight(plan, peak.startDate, plan.maxGuests);
  return `Peak nights: ${day(peak.startDate)} to ${day(addDays(peak.endDate, -1))}. Minimum stay: ${peak.minNights} night${peak.minNights === 1 ? "" : "s"}. Whole villa: ${low === high ? rupees(low) : `${rupees(low)} to ${rupees(high)}`} a night for two guests, ${rupees(top)} for ${plan.maxGuests}, booked direct.`;
}

const FESTIVAL_PATHS: Record<string, string> = {
  "/poush-mela-stay-shantiniketan": "poush-mela",
  "/basanta-utsav-stay-shantiniketan": "basanta-utsav",
};

/** The page's HTML with its loading line replaced by the live facts; unchanged for other pages. */
export function withRateFacts(html: string, pathname: string, plan: RatePlan | null, today: string, rateForNight: NightPrice): string {
  if (!plan) return html;
  if (pathname === "/rates") return html.replace(RATES_PLACEHOLDER, () => ratesLine(plan));
  const peakId = FESTIVAL_PATHS[pathname];
  const line = peakId ? festivalLine(plan, peakId, today, rateForNight) : null;
  return line ? html.replace(FESTIVAL_PLACEHOLDER, () => line) : html;
}
