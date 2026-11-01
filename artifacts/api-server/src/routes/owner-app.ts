import { Router, type IRouter } from "express";

import {
  clearAttempts,
  confirmedForSensitive,
  isAdminAuthConfigured,
  recordFailedAttempt,
  requireAdmin,
  sessionOf,
  tooManyAttempts,
  verifyAdminPassword,
} from "../lib/admin-auth";
import { logger } from "../lib/logger";
import {
  audit,
  createDevice,
  listDevices,
  recentAudit,
  revokeDevice,
  activePushTokens,
  forgetPushTokens,
  pushTokenOf,
  setPushToken,
} from "../lib/owner-devices";
import { listOwnerAlerts, markOwnerAlertsRead } from "../lib/owner-alerts";
import { pushToPhones } from "../lib/expo-push";
import { quietHoursNow } from "../lib/owner-settings-state";
import { isExpoPushToken, publicDevice, readDeviceInfo } from "../lib/owner-devices-rules";
import { loadOwnerSettings, saveOwnerSettings, storedOwnerSettings } from "../lib/owner-settings";
import { applySettingsPatch, settingsView } from "../lib/owner-settings-rules";

/**
 * The owner's phone app (sign-in, its phones, push tokens) and the Settings
 * console shared by the app and /admin/settings.
 */
const router: IRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/* ------------------------------------------------------------ app sign-in */

/**
 * Password in, a token for this phone out. Shares the web login's throttle
 * (per IP, 8 tries in 15 minutes). The token is returned once; the phone keeps
 * it in secure storage behind the owner's fingerprint.
 */
router.post("/admin/app/login", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!isAdminAuthConfigured()) {
    res.status(503).json({ error: "Admin access is not configured on the server yet." });
    return;
  }
  const key = `app:${req.ip ?? "unknown"}`;
  if (tooManyAttempts(key)) {
    res.status(429).json({ error: "Too many sign-in attempts. Please wait 15 minutes and try again." });
    return;
  }
  const password: unknown = req.body?.password;
  if (typeof password !== "string" || password.length === 0 || password.length > 512) {
    recordFailedAttempt(key);
    res.status(400).json({ error: "Please enter your password." });
    return;
  }
  if (!(await verifyAdminPassword(password))) {
    recordFailedAttempt(key);
    logger.warn({ key }, "Failed owner app sign-in attempt");
    res.status(401).json({ error: "That password is not correct." });
    return;
  }
  clearAttempts(key);
  try {
    const { device, token } = await createDevice(readDeviceInfo(req.body));
    void audit({ via: "app", deviceId: device.id, action: "device.signed_in", detail: { name: device.name, platform: device.platform } });
    logger.info({ deviceId: device.id }, "Owner app signed in");
    res.status(201).json({ token, device: publicDevice(device, device.id) });
  } catch (error) {
    logger.error({ err: error }, "Could not register the owner's phone");
    res.status(500).json({ error: "Could not sign this phone in just now. Please try again." });
  }
});

/** The phone signs itself out: its token stops working at once. */
router.post("/admin/app/logout", requireAdmin, async (_req, res) => {
  const session = sessionOf(res);
  if (session.via !== "app") {
    res.status(400).json({ error: "Only the phone app signs out this way." });
    return;
  }
  await revokeDevice(session.deviceId);
  void audit({ via: "app", deviceId: session.deviceId, action: "device.signed_out" });
  res.status(204).end();
});

/** Where this phone receives alerts. Null turns them off for this phone. */
router.put("/admin/app/push-token", requireAdmin, async (req, res) => {
  const session = sessionOf(res);
  if (session.via !== "app") {
    res.status(400).json({ error: "Only the phone app registers for alerts." });
    return;
  }
  const pushToken: unknown = req.body?.pushToken;
  if (pushToken !== null && !isExpoPushToken(pushToken)) {
    res.status(400).json({ error: "That is not a push token this server can use." });
    return;
  }
  await setPushToken(session.deviceId, pushToken);
  res.status(204).end();
});

/* --------------------------------------------------------------- phones */

router.get("/admin/devices", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const session = sessionOf(res);
  const current = session.via === "app" ? session.deviceId : null;
  res.json({ devices: (await listDevices()).map((d) => publicDevice(d, current)) });
});

/** Signs a phone out from anywhere (a lost phone). Sensitive: needs a fresh confirmation. */
router.delete("/admin/devices/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Invalid phone id." });
    return;
  }
  if (!(await confirmedForSensitive(req, res))) {
    res.status(403).json({ error: "Enter your admin password to sign a phone out.", needsConfirmation: true });
    return;
  }
  const session = sessionOf(res);
  if (!(await revokeDevice(id))) {
    res.status(404).json({ error: "That phone is not on the list." });
    return;
  }
  void audit({ via: session.via, deviceId: session.via === "app" ? session.deviceId : null, action: "device.revoked", detail: { revokedId: id } });
  res.status(204).end();
});

/* ------------------------------------------------------------- settings */

router.get("/admin/settings", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  await loadOwnerSettings();
  res.json(settingsView(storedOwnerSettings(), process.env));
});

/**
 * Changes some settings. `null` or "" puts a field back to its Railway value.
 * Changing where alerts go, a phone number or the WhatsApp mode needs a fresh
 * confirmation (fingerprint in the app, `confirmPassword` on the web).
 */
router.patch("/admin/settings", requireAdmin, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const before = await loadOwnerSettings();
  const result = applySettingsPatch(before, req.body, process.env);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  if (result.sensitive && !(await confirmedForSensitive(req, res))) {
    res.status(403).json({ error: "Enter your admin password to change this setting.", needsConfirmation: true });
    return;
  }
  if (result.changed.length > 0) {
    try {
      await saveOwnerSettings(result.next);
    } catch (error) {
      logger.error({ err: error }, "Could not save owner settings");
      res.status(500).json({ error: "Could not save your settings just now. Please try again." });
      return;
    }
    const session = sessionOf(res);
    void audit({
      via: session.via,
      deviceId: session.via === "app" ? session.deviceId : null,
      action: "settings.changed",
      detail: Object.fromEntries(
        result.changed.map((key) => [
          key,
          {
            from: (before as Record<string, unknown>)[key] ?? null,
            to: (result.next as Record<string, unknown>)[key] ?? null,
          },
        ]),
      ),
    });
  }
  res.json({ changed: result.changed, settings: settingsView(storedOwnerSettings(), process.env) });
});

/* --------------------------------------------------------------- alerts */

/** The app's alert list: everything the owner was told about, newest first, with the unread count. */
router.get("/admin/alerts", requireAdmin, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  res.json(await listOwnerAlerts(limit));
});

/** `{ ids: [...] }` marks those read; an empty body marks everything read. */
router.post("/admin/alerts/read", requireAdmin, async (req, res) => {
  const ids: unknown = req.body?.ids;
  if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !UUID.test(id)))) {
    res.status(400).json({ error: "ids must be a list of alert ids." });
    return;
  }
  await markOwnerAlertsRead(ids as string[] | undefined);
  res.status(204).end();
});

/**
 * Sends a test alert, to check notifications from Settings. From the app it
 * goes to that phone only; from the web, to every signed-in phone.
 */
router.post("/admin/alerts/test", requireAdmin, async (_req, res) => {
  const session = sessionOf(res);
  const tokens = session.via === "app" ? [await pushTokenOf(session.deviceId)].filter((t): t is string => Boolean(t)) : await activePushTokens();
  if (tokens.length === 0) {
    res.status(409).json({ error: session.via === "app" ? "This phone has not turned on notifications yet." : "No signed-in phone has notifications turned on." });
    return;
  }
  const quiet = quietHoursNow(new Date());
  const result = await pushToPhones(tokens, { title: "Test from Raj Kuthir", body: quiet ? "Notifications work. It is quiet hours, so this one came without sound." : "Notifications work.", data: { alertId: "", event: "test", href: "/admin" } }, quiet);
  await forgetPushTokens(result.dead);
  res.json({ sent: result.sent, quiet, signedOutPhones: result.dead.length });
});

/** Who changed what, newest first: settings, phones signing in and out, manual sends. */
router.get("/admin/audit", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ entries: await recentAudit(100) });
});

export default router;
