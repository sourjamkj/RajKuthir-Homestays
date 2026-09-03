import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminRouter from "./admin";
import calendarRouter from "./calendar";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adminRouter);
router.use(calendarRouter);

export default router;
