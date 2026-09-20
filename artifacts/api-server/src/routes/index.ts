import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminRouter from "./admin";
import calendarRouter from "./calendar";
import ratesRouter from "./rates";
import ledgerRouter from "./ledger";
import enquiriesRouter from "./enquiries";
import notificationsRouter from "./notifications";
import guestRouter from "./guest";
import guestOnboardingRouter from "./guest-onboarding";
import mailRouter from "./mail";
import activityRouter from "./activity";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adminRouter);
router.use(calendarRouter);
router.use(ratesRouter);
router.use(ledgerRouter);
router.use(enquiriesRouter);
router.use(notificationsRouter);
router.use(guestRouter);
router.use(guestOnboardingRouter);
router.use(mailRouter);
router.use(activityRouter);

export default router;
