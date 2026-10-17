import { Router, type IRouter } from "express";
import { MAX_GUESTS } from "@workspace/db";
import {
  CHILD_UNDER_AGE,
  EXTRA_ADULT_PAISE,
  EXTRA_CHILD_PAISE,
  PET_PAISE,
} from "../lib/party";
import { requireAdmin } from "../lib/admin-auth";
import {
  createOverride,
  deleteOverride,
  getLadder,
  getPeaks,
  getRatePlan,
  saveLadder,
  savePeaks,
  updateOverride,
  type RateMode,
} from "../lib/rates-repo";
import { ladderProblem, peakProblem, type PeakPeriod } from "../lib/pricing.ts";
import { randomUUID } from "node:crypto";

const router: IRouter = Router();

const MAX_RUPEES = 1_000_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MODES: readonly RateMode[] = ["fixed", "percent", "demand"];

/**
 * A percentage uplift. Negative is allowed — a quiet-season discount is the
 * same mechanism pointed the other way — but bounded so a stray keystroke
 * cannot price the villa at zero or at a lakh a night.
 */
function parsePercent(value: unknown): number | null {
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < -90 || percent > 500) return null;
  return Math.round(percent);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/** Rupees in, paise out. Returns null when the value is unusable. */
function toPaise(value: unknown): number | null {
  const rupees = Number(value);
  if (!Number.isFinite(rupees) || rupees <= 0 || rupees > MAX_RUPEES) {
    return null;
  }
  return Math.round(rupees * 100);
}

/**
 * Parses a { "1": 2610, "2": 2900, ... } rupee map into paise. Entries outside
 * the valid occupancy range are dropped rather than failing the whole request,
 * so a stray key cannot block a price change.
 */
function parseAmounts(raw: unknown): Record<string, number> {
  const source =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const amounts: Record<string, number> = {};

  for (const [key, value] of Object.entries(source)) {
    const guests = Number(key);
    if (!Number.isInteger(guests) || guests < 1 || guests > MAX_GUESTS) continue;

    const paise = toPaise(value);
    if (paise !== null) amounts[String(guests)] = paise;
  }

  return amounts;
}

/**
 * Public: guests see prices on the availability calendar, so this is
 * deliberately unauthenticated. It exposes prices only, never bookings.
 */
/**
 * The public rate card, including the surcharge rules.
 *
 * The extras ship with the plan rather than being hard-coded in the browser
 * so there is exactly one place these numbers live. The booking page shows
 * what the server will charge, by construction, instead of a copy that
 * quietly goes stale the day a price changes.
 */
router.get("/rates", async (_req, res) => {
  const plan = await getRatePlan();
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({
    ...plan,
    extras: {
      childUnderAge: CHILD_UNDER_AGE,
      extraAdultPaise: EXTRA_ADULT_PAISE,
      extraChildPaise: EXTRA_CHILD_PAISE,
      petPaise: PET_PAISE,
    },
  });
});

/** A whole-rupee amount from the console, as paise; null if missing or silly. */
function rupeesToPaise(value: unknown, { allowZero = false } = {}): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const rupees = Number(value);
  if (!Number.isFinite(rupees) || rupees > MAX_RUPEES) return null;
  if (rupees < 0 || (!allowZero && rupees === 0)) return null;
  return Math.round(rupees) * 100;
}

/**
 * The rate ladder: weekday and weekend base for up to two guests, the
 * per-guest charge beyond that, the floor and the weekly discount. Rupees in.
 */
router.put("/rates/ladder", requireAdmin, async (req, res) => {
  const body = req.body ?? {};
  const current = await getLadder();
  const next = {
    ...current,
    weekdayBasePaise: rupeesToPaise(body.weekdayBase) ?? -1,
    weekendBasePaise: rupeesToPaise(body.weekendBase) ?? -1,
    extraGuestPaise: rupeesToPaise(body.extraGuest, { allowZero: true }) ?? -1,
    floorPaise: rupeesToPaise(body.floor) ?? -1,
    weeklyDiscountPercent: Math.round(Number(body.weeklyDiscountPercent)),
  };

  const problem = ladderProblem(next);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  await saveLadder(next);
  res.json(await getRatePlan());
});

/**
 * Peak periods arrive as first and last NIGHT, both inclusive, because that
 * is how the owner thinks of them ("22 Dec to 1 Jan"). Stored half-open like
 * every other range, so the end becomes the morning after the last night.
 */
function parsePeak(body: Record<string, unknown> | undefined, id: string):
  | { error: string }
  | { value: PeakPeriod } {
  const firstNight = String(body?.firstNight ?? "");
  const lastNight = String(body?.lastNight ?? "");
  if (!ISO_DATE.test(firstNight) || !ISO_DATE.test(lastNight)) {
    return { error: "Choose valid first and last nights." };
  }
  const end = new Date(`${lastNight}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  const rawRate = body?.bookingComRate;
  const bookingComPaise =
    rawRate === "" || rawRate === null || rawRate === undefined
      ? null
      : rupeesToPaise(rawRate);
  if (bookingComPaise === null && !(rawRate === "" || rawRate === null || rawRate === undefined)) {
    return { error: "The Booking.com rate must be a positive amount." };
  }

  const value: PeakPeriod = {
    id,
    label: String(body?.label ?? "").slice(0, 120).trim(),
    startDate: firstNight,
    endDate: end.toISOString().slice(0, 10),
    bookingComPaise,
    discountPercent: Math.round(Number(body?.discountPercent ?? 10)),
    minNights: Math.round(Number(body?.minNights ?? 2)),
  };
  const problem = peakProblem(value);
  return problem ? { error: problem } : { value };
}

const PEAK_ID = /^[a-z0-9-]{1,80}$/i;

router.post("/rates/peaks", requireAdmin, async (req, res) => {
  const parsed = parsePeak(req.body, randomUUID());
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  await savePeaks([...(await getPeaks()), parsed.value]);
  res.status(201).json(await getRatePlan());
});

router.patch("/rates/peaks/:id", requireAdmin, async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;
  const peaks = await getPeaks();
  if (!PEAK_ID.test(id) || !peaks.some((peak) => peak.id === id)) {
    res.status(404).json({ error: "That peak period no longer exists." });
    return;
  }
  const parsed = parsePeak(req.body, id);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  await savePeaks(peaks.map((peak) => (peak.id === id ? parsed.value : peak)));
  res.json(await getRatePlan());
});

router.delete("/rates/peaks/:id", requireAdmin, async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;
  const peaks = await getPeaks();
  if (!PEAK_ID.test(id) || !peaks.some((peak) => peak.id === id)) {
    res.status(404).json({ error: "That peak period no longer exists." });
    return;
  }
  await savePeaks(peaks.filter((peak) => peak.id !== id));
  res.status(204).end();
});

type OverrideInput = {
  startDate: string;
  endDate: string;
  label: string | null;
  mode: RateMode;
  amounts?: Record<string, number>;
  percent?: number;
  minPercent?: number;
  maxPercent?: number;
  demandThreshold?: number;
};

/**
 * One validator for both create and edit. Splitting them is how the two
 * quietly diverge — an edit that accepts something a create would reject.
 */
function parseOverrideBody(
  body: Record<string, unknown> | undefined,
): { error: string } | { value: OverrideInput } {
  const startDate = String(body?.startDate ?? "");
  const endDate = String(body?.endDate ?? "");
  const rawLabel = body?.label;
  const label = typeof rawLabel === "string" ? rawLabel.slice(0, 120) : null;
  const mode = String(body?.mode ?? "fixed") as RateMode;

  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
    return { error: "Choose a valid start and end date." };
  }

  if (endDate <= startDate) {
    return { error: "The end date must be after the start date." };
  }

  if (!MODES.includes(mode)) {
    return { error: "Choose a valid pricing mode." };
  }

  const base = { startDate, endDate, label, mode };

  if (mode === "fixed") {
    const amounts = parseAmounts(body?.amounts);
    if (Object.keys(amounts).length === 0) {
      return { error: "Enter at least one peak price for this period." };
    }
    return { value: { ...base, amounts } };
  }

  if (mode === "percent") {
    const percent = parsePercent(body?.percent);
    if (percent === null) {
      return { error: "Enter a percentage between -90 and 500." };
    }
    return { value: { ...base, percent } };
  }

  const minPercent = parsePercent(body?.minPercent);
  const maxPercent = parsePercent(body?.maxPercent);
  const threshold = Number(body?.demandThreshold);

  if (minPercent === null || maxPercent === null) {
    return { error: "Enter both a minimum and maximum percentage." };
  }

  if (maxPercent < minPercent) {
    return { error: "The maximum percentage must be at least the minimum." };
  }

  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 1000) {
    return {
      error: "Enter how many enquiries should reach the top price (1-1000).",
    };
  }

  return {
    value: { ...base, minPercent, maxPercent, demandThreshold: threshold },
  };
}

router.post("/rates/overrides", requireAdmin, async (req, res) => {
  const parsed = parseOverrideBody(req.body);

  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  res.status(201).json(await createOverride(parsed.value));
});

router.patch("/rates/overrides/:id", requireAdmin, async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;

  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid price rule id." });
    return;
  }

  const parsed = parseOverrideBody(req.body);

  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const updated = await updateOverride(id, parsed.value);

  if (!updated) {
    res.status(404).json({ error: "That price rule no longer exists." });
    return;
  }

  res.json(updated);
});

router.delete("/rates/overrides/:id", requireAdmin, async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;

  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid price rule id." });
    return;
  }

  const removed = await deleteOverride(id);

  if (!removed) {
    res.status(404).json({ error: "That price rule no longer exists." });
    return;
  }

  res.status(204).end();
});

export default router;
