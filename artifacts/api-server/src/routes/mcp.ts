import express, { Router, type IRouter } from "express";
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { clearAttempts, recordFailedAttempt, requireAdmin, tooManyAttempts, verifyAdminPassword } from "../lib/admin-auth";
import { logger } from "../lib/logger";
import { buildMcpServer } from "../lib/mcp-tools";
import {
  CONSENT_SECRET,
  connectorStatus,
  createAuthorizationCode,
  mcpOAuthProvider,
  revokeAllConnectorAccess,
} from "../lib/mcp-oauth";
import { consentPage, MCP_SCOPE, readConsent, redirectWith } from "../lib/mcp-oauth-rules";
import { audit } from "../lib/owner-devices";

/**
 * The Raj Kuthir connector for Claude: an MCP server at /mcp, behind OAuth.
 *
 * The owner adds https://rajkuthirhomestays.casa/mcp as a custom connector in
 * Claude; Claude registers itself, the owner signs in on this site's own page
 * with the admin password (it never passes through Claude), and the tools can
 * then add and update enquiries, send quotes, mark advances and create
 * bookings for him. Mounted at the root: OAuth discovery lives at
 * /.well-known/*, /authorize, /token, /register and /revoke.
 */

const BASE = (process.env["PUBLIC_BASE_URL"]?.trim() || "https://rajkuthirhomestays.casa").replace(/\/$/, "");
const MCP_URL = new URL(`${BASE}/mcp`);

const router: IRouter = Router();

router.use(
  mcpAuthRouter({
    provider: mcpOAuthProvider,
    issuerUrl: new URL(BASE),
    resourceServerUrl: MCP_URL,
    scopesSupported: [MCP_SCOPE],
    resourceName: "Raj Kuthir Homestays – Sobuj Potro",
  }),
);

/** The owner's answer on the password page. */
router.post("/oauth/consent", express.urlencoded({ extended: false, limit: "16kb" }), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  const signed = String(req.body?.request ?? "");
  const request = readConsent(signed, CONSENT_SECRET());
  if (!request) {
    res.status(400).type("text/plain").send("This sign-in page has expired. Go back to Claude and press Connect again.");
    return;
  }

  // The redirect must still be one this client registered.
  const client = await mcpOAuthProvider.clientsStore.getClient(request.clientId);
  if (!client || !client.redirect_uris.map(String).includes(request.redirectUri)) {
    res.status(400).type("text/plain").send("This sign-in request is not valid. Go back to Claude and press Connect again.");
    return;
  }

  if (req.body?.decision !== "allow") {
    res.redirect(303, redirectWith(request.redirectUri, { error: "access_denied", error_description: "The owner did not allow it.", state: request.state }));
    return;
  }

  const key = `mcp:${req.ip ?? "unknown"}`;
  const page = (error: string, status: number) =>
    res.status(status).type("html").send(consentPage({ signed, clientName: request.clientName, redirectHost: new URL(request.redirectUri).host, error }));

  if (tooManyAttempts(key)) {
    page("Too many wrong passwords. Wait 15 minutes and try again.", 429);
    return;
  }
  const password = String(req.body?.password ?? "");
  if (!password || password.length > 512 || !(await verifyAdminPassword(password))) {
    recordFailedAttempt(key);
    logger.warn({ clientId: request.clientId }, "Claude connector sign-in: wrong password");
    page("That password is not right.", 401);
    return;
  }
  clearAttempts(key);

  const code = await createAuthorizationCode({
    clientId: request.clientId,
    codeChallenge: request.codeChallenge,
    redirectUri: request.redirectUri,
    scopes: request.scopes,
    resource: request.resource,
  });
  void audit({ via: "web", deviceId: null, action: "claude.connected", detail: { client: request.clientName } });
  res.redirect(303, redirectWith(request.redirectUri, { code, state: request.state }));
});

const bearer = requireBearerAuth({
  verifier: mcpOAuthProvider,
  requiredScopes: [MCP_SCOPE],
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(MCP_URL),
});

/** Stateless Streamable HTTP: a fresh server per request, nothing kept between calls. */
router.post("/mcp", bearer, async (req, res) => {
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error({ err: error }, "Claude connector request failed");
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  }
});

router.all("/mcp", (_req, res) => {
  res.setHeader("Allow", "POST");
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
});

/** Settings: is Claude connected; and disconnect it everywhere. */
router.get("/api/admin/claude-connector", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ url: MCP_URL.toString(), ...(await connectorStatus()) });
});

router.post("/api/admin/claude-connector/disconnect", requireAdmin, async (_req, res) => {
  const revoked = await revokeAllConnectorAccess();
  void audit({ via: "web", deviceId: null, action: "claude.disconnected", detail: { revoked } });
  res.json({ disconnected: true, revoked });
});

export default router;
