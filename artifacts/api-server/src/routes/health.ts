import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { invoiceHealth } from "../lib/invoice-selfcheck";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Whether invoice and confirmation PDFs can be made right now, from the
 * hourly self-check on a fictional booking. No guest data; safe to be public.
 */
router.get("/health/invoices", async (_req, res) => {
  const result = await invoiceHealth();
  res.setHeader("Cache-Control", "no-store");
  res.status(result.ok ? 200 : 503).json(result);
});

export default router;
