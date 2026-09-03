import { Router, type IRouter } from "express";
import { MAX_GUESTS } from "@workspace/db";
import { requireAdmin } from "../lib/admin-auth";
import {
  createOverride,
  deleteOverride,
  getRatePlan,
  setNightlyRates,
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

router.post("/rates/overrides", requireAdmin, async (req, res) => {
  const startDate = String(req.body?.startDate ?? "");
  const endDate = String(req.body?.endDate ?? "");
  const rawLabel = req.body?.label;
  const label = typeof rawLabel === "string" ? rawLabel.slice(0, 120) : null;
  const mode = String(req.body?.mode ?? "fixed") as RateMode;

  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
    res.status(400).json({ error: "Choose a valid start and end date." });
    return;
  }

  if (endDate <= startDate) {
    res.status(400).json({ error: "The end date must be after the start date." });
    return;
  }

  if (!MODES.includes(mode)) {
    res.status(400).json({ error: "Choose a valid pricing mode." });
    return;
  }

  if (mode === "fixed") {
    const amounts = parseAmounts(req.body?.amounts);

    if (Object.keys(amounts).length === 0) {
      res.status(400).json({
        error: "Enter at least one peak price for this period.",
      });
      return;
    }

    const created = await createOverride({
      startDate,
      endDate,
      label,
      mode,
      amounts,
    });
    res.status(201).json(created);
    return;
  }

  if (mode === "percent") {
    const percent = parsePercent(req.body?.percent);

    if (percent === null) {
      res.status(400).json({
        error: "Enter a percentage between -90 and 500.",
      });
      return;
    }

    const created = await createOverride({
      startDate,
      endDate,
      label,
      mode,
      percent,
    });
    res.status(201).json(created);
    return;
  }

  // demand
  const minPercent = parsePercent(req.body?.minPercent);
  const maxPercent = parsePercent(req.body?.maxPercent);
  const threshold = Number(req.body?.demandThreshold);

  if (minPercent === null || maxPercent === null) {
    res.status(400).json({
      error: "Enter both a minimum and maximum percentage.",
    });
    return;
  }

  if (maxPercent < minPercent) {
    res.status(400).json({
      error: "The maximum percentage must be at least the minimum.",
    });
    return;
  }

  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 1000) {
    res.status(400).json({
      error: "Enter how many enquiries should reach the top price (1-1000).",
    });
    return;
  }

  const created = await createOverride({
    startDate,
    endDate,
    label,
    mode,
    minPercent,
    maxPercent,
    demandThreshold: threshold,
  });
  res.status(201).json(created);
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
