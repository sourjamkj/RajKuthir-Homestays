import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import {
  clearAttempts,
  clearSessionCookie,
  isAdminAuthConfigured,
  isSignedIn,
  recordFailedAttempt,
  setSessionCookie,
  tooManyAttempts,
  verifyAdminPassword,
} from "../lib/admin-auth";

const router: IRouter = Router();

function clientKey(req: { ip?: string }): string {
  return req.ip ?? "unknown";
}

router.get("/admin/me", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    signedIn: isSignedIn(req),
    configured: isAdminAuthConfigured(),
  });
});

router.post("/admin/login", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!isAdminAuthConfigured()) {
    res.status(503).json({
      error:
        "Admin access is not configured on the server yet. Set the admin password variables and redeploy.",
    });
    return;
  }

  const key = clientKey(req);

  if (tooManyAttempts(key)) {
    res.status(429).json({
      error: "Too many sign-in attempts. Please wait 15 minutes and try again.",
    });
    return;
  }

  const password: unknown = req.body?.password;

  if (typeof password !== "string" || password.length === 0) {
    recordFailedAttempt(key);
    res.status(400).json({ error: "Please enter your password." });
    return;
  }

  // Guard against absurdly long inputs before handing them to scrypt.
  if (password.length > 512) {
    recordFailedAttempt(key);
    res.status(401).json({ error: "That password is not correct." });
    return;
  }

  const valid = await verifyAdminPassword(password);

  if (!valid) {
    recordFailedAttempt(key);
    logger.warn({ key }, "Failed admin sign-in attempt");
    res.status(401).json({ error: "That password is not correct." });
    return;
  }

  clearAttempts(key);
  setSessionCookie(res);
  logger.info("Admin signed in");
  res.json({ signedIn: true });
});

router.post("/admin/logout", (_req, res) => {
  clearSessionCookie(res);
  res.setHeader("Cache-Control", "no-store");
  res.json({ signedIn: false });
});

export default router;
