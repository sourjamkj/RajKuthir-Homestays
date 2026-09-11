import { Router, type IRouter } from "express";

import { requireAdmin } from "../lib/admin-auth";
import { logger } from "../lib/logger";
import {
  createAccount,
  deleteAccount,
  listAccounts,
  rewind,
  updateAccount,
} from "../lib/mail-repo";
import { getLastMailSync, isMailSyncInFlight, runMailSync } from "../lib/mail-runner";
import { encryptionAvailable } from "../lib/secret-box";

/**
 * Mailbox administration.
 *
 * Every route here is admin-only, without exception: these rows are mailbox
 * credentials. Note what is absent — there is no endpoint that returns a
 * password, not even a masked one, and no endpoint that tests a password by
 * echoing it back. The only way to find out whether a password works is to
 * run a sync and read the error.
 */

const router: IRouter = Router();

router.use("/mail", requireAdmin);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown, max: number): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw.slice(0, max) : null;
}

function port(value: unknown): number | null {
  const parsed = Number(value ?? 993);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return null;
  return parsed;
}

router.get("/mail/accounts", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    accounts: await listAccounts(),
    // The screen needs to explain why nothing is syncing when the key is
    // missing, rather than showing mailboxes that silently never run.
    encryptionConfigured: encryptionAvailable(),
    lastSync: getLastMailSync(),
    running: isMailSyncInFlight(),
  });
});

router.post("/mail/accounts", async (req, res) => {
  if (!encryptionAvailable()) {
    res.status(503).json({
      error:
        "MAIL_ENCRYPTION_KEY is not set on the server, so a mailbox password cannot be stored safely. Set it and redeploy before adding an account.",
    });
    return;
  }

  const label = text(req.body?.label, 120);
  const host = text(req.body?.host, 200);
  const username = text(req.body?.username, 200);
  const password = text(req.body?.password, 400);
  const folder = text(req.body?.folder, 200) ?? "INBOX";
  const parsedPort = port(req.body?.port);

  if (!label || !host || !username || !password) {
    res.status(400).json({
      error: "A label, host, username and password are all required.",
    });
    return;
  }

  if (parsedPort === null) {
    res.status(400).json({ error: "Port must be between 1 and 65535." });
    return;
  }

  try {
    const account = await createAccount({
      label,
      host,
      username,
      password,
      folder,
      port: parsedPort,
      secure: req.body?.secure !== false,
    });

    // Deliberately no password anywhere in this log line.
    logger.info({ accountId: account.id, host, folder }, "Mailbox added");
    res.status(201).json({ account });
  } catch (error) {
    logger.error({ err: error }, "Could not add mailbox");
    res.status(500).json({ error: "Could not save that mailbox." });
  }
});

router.patch("/mail/accounts/:id", async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Invalid mailbox id." });
    return;
  }

  const patch: Record<string, unknown> = {};
  if (req.body?.label !== undefined) patch.label = text(req.body.label, 120);
  if (req.body?.host !== undefined) patch.host = text(req.body.host, 200);
  if (req.body?.username !== undefined) patch.username = text(req.body.username, 200);
  if (req.body?.folder !== undefined) patch.folder = text(req.body.folder, 200);
  if (req.body?.enabled !== undefined) patch.enabled = Boolean(req.body.enabled);
  if (req.body?.secure !== undefined) patch.secure = Boolean(req.body.secure);

  if (req.body?.port !== undefined) {
    const parsedPort = port(req.body.port);
    if (parsedPort === null) {
      res.status(400).json({ error: "Port must be between 1 and 65535." });
      return;
    }
    patch.port = parsedPort;
  }

  // An empty password field means "leave it alone", never "erase it".
  const password = text(req.body?.password, 400);
  if (password) {
    if (!encryptionAvailable()) {
      res.status(503).json({
        error: "MAIL_ENCRYPTION_KEY is not set, so the password cannot be stored.",
      });
      return;
    }
    patch.password = password;
  }

  const account = await updateAccount(id, patch);
  if (!account) {
    res.status(404).json({ error: "No such mailbox." });
    return;
  }

  res.json({ account });
});

router.delete("/mail/accounts/:id", async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Invalid mailbox id." });
    return;
  }

  const removed = await deleteAccount(id);
  if (!removed) {
    res.status(404).json({ error: "No such mailbox." });
    return;
  }

  res.json({ deleted: true });
});

/**
 * Forget the high-water mark so the next run reads the folder from the start.
 * For after a parser fix, when emails that were skipped need a second look.
 */
router.post("/mail/accounts/:id/rewind", async (req, res) => {
  const id = Array.isArray(req.params.id) ? "" : req.params.id;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Invalid mailbox id." });
    return;
  }

  const done = await rewind(id);
  if (!done) {
    res.status(404).json({ error: "No such mailbox." });
    return;
  }

  res.json({ rewound: true });
});

/** Runs every enabled mailbox now rather than waiting for the two-hour cron. */
router.post("/mail/sync", async (_req, res) => {
  try {
    res.json({ result: await runMailSync() });
  } catch (error) {
    logger.error({ err: error }, "Manual mailbox sync failed");
    res.status(500).json({ error: "The mailbox check could not be completed." });
  }
});

export default router;
