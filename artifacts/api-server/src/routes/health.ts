import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { invoiceHealth } from "../lib/invoice-selfcheck";
import { opsStatus } from "../lib/ops-watch";

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

/**
 * Overall status from the ops watch: ok / degraded / down, and which checks
 * are open since when. No error text, no guest data. 503 while a P0/P1 is
 * open, so the outside uptime monitor fails too.
 */
router.get("/health/ops", (_req, res) => {
  const { httpStatus, body } = opsStatus();
  res.setHeader("Cache-Control", "no-store");
  res.status(httpStatus).json(body);
});

export default router;
