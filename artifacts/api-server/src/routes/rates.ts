import { Router, type IRouter } from "express";
import { MAX_GUESTS } from "@workspace/db";
import { requireAdmin } from "../lib/admin-auth";
import {
  createOverride,
  deleteOverride,
  getRatePlan,
  setNightlyRates,
  updateOverride,
  type RateMode,
} from "../lib/rates-repo";

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
router.get("/rates", async (_req, res) => {
  const plan = await getRatePlan();
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json(plan);
});

router.put("/rates", requireAdmin, async (req, res) => {
  const amounts = parseAmounts(req.body?.rates);

  if (Object.keys(amounts).length === 0) {
    res.status(400).json({
      error: `Enter at least one nightly price, for 1 to ${MAX_GUESTS} guests.`,
    });
    return;
  }

  const next: Record<number, number> = {};
  for (const [guests, paise] of Object.entries(amounts)) {
    next[Number(guests)] = paise;
  }

  await setNightlyRates(next);
  res.json(await getRatePlan());
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
