import type { Ladder, PeakPeriod } from "./pricing.ts";
import { nextPeak } from "./rate-edit-rules.ts";

/** The owner's sale rates (8 Nov 2026), pure; applied once at boot by rate-plan-sale-nov-2026.ts. */
export const SALE_PLAN_ID = "sale-rates-2026-11-08";

const PEAK_PRICE_FOR_5_RUPEES = 4500;

export const SALE_PEAKS: { id: string; label: string; firstNight: string; lastNight: string }[] = [
  { id: "poush-mela-2026", label: "Poush Mela", firstNight: "2026-12-23", lastNight: "2026-12-27" },
  { id: "new-year-2026-27", label: "New Year", firstNight: "2026-12-31", lastNight: "2027-01-01" },
  { id: "basanta-utsav-2027", label: "Basanta Utsav", firstNight: "2027-03-19", lastNight: "2027-03-22" },
  { id: "poush-mela-2027", label: "Poush Mela", firstNight: "2027-12-23", lastNight: "2027-12-27" },
  { id: "new-year-2027-28", label: "New Year", firstNight: "2027-12-31", lastNight: "2028-01-01" },
];

/** Pure: the sale ladder and peaks from what is saved now. */
export function salePlan(current: Ladder, existingPeaks: PeakPeriod[]): { ladder: Ladder; peaks: PeakPeriod[] } {
  const ladder: Ladder = { ...current, weekdayBasePaise: 290_000, weekendBasePaise: 290_000, extraGuestPaise: 20_000, floorPaise: 290_000 };
  const replaced = new Set(["poush-mela-new-year-2026", "basanta-utsav-2027", ...SALE_PEAKS.map((p) => p.id)]);
  const kept = existingPeaks.filter((p) => !replaced.has(p.id));
  const made = SALE_PEAKS.map((p) => {
    const built = nextPeak(null, { label: p.label, firstNight: p.firstNight, lastNight: p.lastNight, priceFor5GuestsRupees: PEAK_PRICE_FOR_5_RUPEES, discountPercent: 10, minNights: 2 }, ladder, p.id);
    if (!built.ok) throw new Error(`${p.label}: ${built.error}`);
    return built.peak;
  });
  return { ladder, peaks: [...kept, ...made].sort((a, b) => a.startDate.localeCompare(b.startDate)) };
}

