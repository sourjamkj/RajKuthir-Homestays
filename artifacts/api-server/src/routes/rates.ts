import { Router, type IRouter } from "express";
import { MAX_GUESTS } from "@workspace/db";
import { requireAdmin } from "../lib/admin-auth";
import {
  createOverride,
  deleteOverride,
  getRatePlan,
  setNightlyRates,
} from "../lib/rates-repo";

const router: IRouter = Router();

const MAX_RUPEES = 1_000_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
    res.status(400).json({ error: "Choose a valid start and end date." });
    return;
  }

  if (endDate <= startDate) {
    res.status(400).json({ error: "The end date must be after the start date." });
    return;
  }

  const amounts = parseAmounts(req.body?.amounts);

  if (Object.keys(amounts).length === 0) {
    res.status(400).json({
      error: "Enter at least one peak price for this period.",
    });
    return;
  }

  const created = await createOverride({ startDate, endDate, label, amounts });
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
