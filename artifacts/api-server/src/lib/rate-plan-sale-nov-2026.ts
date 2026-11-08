import { logger } from "./logger";
import { audit } from "./owner-devices";
import { SALE_PLAN_ID, salePlan } from "./rate-plan-sale-rules";
import {
  appliedRatePlans,
  deleteOverride,
  getLadder,
  getPeaks,
  getRatePlan,
  markRatePlanApplied,
  saveLadder,
  savePeaks,
} from "./rates-repo";

/**
 * The owner's direct sale rates (8 Nov 2026), applied once at boot because
 * the Claude connector's new rate tools were not yet reachable from his chat:
 *
 *   Normal nights, every day: ₹2,900 for 1–2 guests, +₹200 per guest,
 *   ₹3,500 for 5; the ₹2,900 floor stays.
 *   Peak nights at ₹4,500 for 5 (2-night minimum), matching the OTA plan:
 *   Poush Mela 23–27 Dec and New Year 31 Dec – 1 Jan, for 2026 and 2027,
 *   and Basanta Utsav 19–22 Mar 2027.
 *   The +40% "New year" rule and the expired "Pre-Puja" rule are removed.
 *
 * Runs once (recorded under its id in app_settings); later edits in the
 * console or through the connector are never overwritten. Audited.
 */
const RULES_TO_REMOVE = /^(new year|pre-puja)$/i;

export async function applySalePlanOnce(): Promise<void> {
  try {
    if ((await appliedRatePlans()).includes(SALE_PLAN_ID)) return;
    const [ladder, peaks, plan] = await Promise.all([getLadder(), getPeaks(), getRatePlan()]);
    const next = salePlan(ladder, peaks);
    await saveLadder(next.ladder);
    await savePeaks(next.peaks);
    const removed: string[] = [];
    for (const rule of plan.overrides) {
      if (rule.label && RULES_TO_REMOVE.test(rule.label.trim()) && (await deleteOverride(rule.id))) removed.push(`${rule.label} (${rule.startDate} – ${rule.endDate})`);
    }
    await markRatePlanApplied(SALE_PLAN_ID);
    await audit({
      via: "claude",
      deviceId: null,
      action: "rates.sale_plan_applied",
      detail: { plan: SALE_PLAN_ID, before: { ladder, peaks }, after: next, removedRules: removed },
    });
    logger.info({ plan: SALE_PLAN_ID, removedRules: removed }, "Sale rate plan applied");
  } catch (error) {
    logger.error({ err: error }, "Could not apply the sale rate plan; rates unchanged");
  }
}
