import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminRouter from "./admin";
import calendarRouter from "./calendar";
import ratesRouter from "./rates";
import ledgerRouter from "./ledger";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adminRouter);
router.use(calendarRouter);
router.use(ratesRouter);
router.use(ledgerRouter);

export default router;
