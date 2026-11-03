import type { Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { pool } from "@workspace/db";

import { logger } from "./logger";
import {
  ACCESS_TTL_MS,
  CODE_TTL_MS,
  CONSENT_TTL_MS,
  consentPage,
  hashSecret,
  MCP_SCOPE,
  newSecret,
  REFRESH_TTL_MS,
  signConsent,
  type GrantKind,
} from "./mcp-oauth-rules";

/**
 * The Claude connector's OAuth server: Claude registers itself, the owner
 * signs in on his own site's page with the admin password, and Claude gets an
 * access token (one hour) and a refresh token (90 days, rotated on use) that
 * reach only /mcp. The tokens never open the console or the app's API:
 * requireAdmin does not know them.
 *
 * Tables created at boot and on first use (additive, idempotent).
 */
export const MCP_OAUTH_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS mcp_clients (
  client_id text PRIMARY KEY,
  info jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mcp_grants (
  secret_hash text PRIMARY KEY,
  kind text NOT NULL,
  client_id text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_grants_client_idx ON mcp_grants (client_id, kind);
`;

let migration: Promise<boolean> | null = null;
export function ensureMcpTables(): Promise<boolean> {
  if (!migration) {
    migration = pool.query(MCP_OAUTH_MIGRATION_SQL).then(
      () => true,
      (error: unknown) => {
        logger.error({ err: error }, "Could not create the Claude connector tables");
        migration = null;
        return false;
      },
    );
  }
  return migration;
}

async function ready() {
  if (!(await ensureMcpTables())) throw new Error("The connector is not ready yet. Please try again in a minute.");
}

export const CONSENT_SECRET = () => process.env["RAJ_KUTHIR_SESSION_SECRET"]?.trim() ?? "";

const clientsStore: OAuthRegisteredClientsStore = {
  async getClient(clientId) {
    await ready();
    const { rows } = await pool.query<{ info: OAuthClientInformationFull }>(`SELECT info FROM mcp_clients WHERE client_id = $1`, [clientId]);
    return rows[0]?.info;
  },
  async registerClient(client) {
    await ready();
    const full = client as OAuthClientInformationFull;
    await pool.query(`INSERT INTO mcp_clients (client_id, info) VALUES ($1, $2) ON CONFLICT (client_id) DO UPDATE SET info = EXCLUDED.info`, [
      full.client_id,
      JSON.stringify(full),
    ]);
    logger.info({ clientId: full.client_id, name: full.client_name ?? null }, "Claude connector client registered");
    return full;
  },
};

type GrantRow = { kind: GrantKind; client_id: string; data: Record<string, unknown>; expires_at: Date; used_at: Date | null; revoked_at: Date | null };

async function insertGrant(kind: GrantKind, clientId: string, data: Record<string, unknown>, ttlMs: number): Promise<string> {
  const secret = newSecret(kind);
  await pool.query(`INSERT INTO mcp_grants (secret_hash, kind, client_id, data, expires_at) VALUES ($1, $2, $3, $4, $5)`, [
    hashSecret(secret),
    kind,
    clientId,
    JSON.stringify(data),
    new Date(Date.now() + ttlMs),
  ]);
  return secret;
}

async function findGrant(secret: string, kind: GrantKind): Promise<GrantRow | null> {
  if (typeof secret !== "string" || secret.length > 200) return null;
  const { rows } = await pool.query<GrantRow>(
    `SELECT kind, client_id, data, expires_at, used_at, revoked_at FROM mcp_grants WHERE secret_hash = $1 AND kind = $2`,
    [hashSecret(secret), kind],
  );
  const row = rows[0];
  if (!row || row.revoked_at || row.expires_at.getTime() <= Date.now()) return null;
  return row;
}

async function issueTokens(clientId: string, data: { scopes: string[]; resource: string | null }): Promise<OAuthTokens> {
  const access = await insertGrant("access", clientId, data, ACCESS_TTL_MS);
  const refresh = await insertGrant("refresh", clientId, data, REFRESH_TTL_MS);
  return {
    access_token: access,
    token_type: "bearer",
    expires_in: Math.round(ACCESS_TTL_MS / 1000),
    scope: data.scopes.join(" "),
    refresh_token: refresh,
  };
}

/** Called from the password page once the owner has allowed it: the one-time code. */
export async function createAuthorizationCode(input: {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  resource: string | null;
}): Promise<string> {
  await ready();
  return insertGrant("code", input.clientId, { codeChallenge: input.codeChallenge, redirectUri: input.redirectUri, scopes: input.scopes, resource: input.resource }, CODE_TTL_MS);
}

export const mcpOAuthProvider: OAuthServerProvider = {
  get clientsStore() {
    return clientsStore;
  },

  /** Shows the owner's password page; the decision is posted to /oauth/consent. */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    const secret = CONSENT_SECRET();
    if (!secret) {
      res.status(503).type("text/plain").send("The console's sign-in is not set up on the server, so Claude cannot be connected yet.");
      return;
    }
    const clientName = client.client_name?.slice(0, 80) || "An app";
    const signed = signConsent(
      {
        clientId: client.client_id,
        clientName,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        state: params.state ?? null,
        scopes: [MCP_SCOPE],
        resource: params.resource?.toString() ?? null,
        expiresAt: Date.now() + CONSENT_TTL_MS,
      },
      secret,
    );
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.status(200).type("html").send(consentPage({ signed, clientName, redirectHost: new URL(params.redirectUri).host }));
  },

  async challengeForAuthorizationCode(client, authorizationCode) {
    await ready();
    const grant = await findGrant(authorizationCode, "code");
    if (!grant || grant.used_at || grant.client_id !== client.client_id) throw new InvalidGrantError("That sign-in code is not valid any more.");
    return String(grant.data.codeChallenge);
  },

  async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri) {
    await ready();
    // Marks the code used in the same statement that reads it, so it works once.
    const { rows } = await pool.query<{ client_id: string; data: Record<string, unknown> }>(
      `UPDATE mcp_grants SET used_at = now()
        WHERE secret_hash = $1 AND kind = 'code' AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        RETURNING client_id, data`,
      [hashSecret(authorizationCode)],
    );
    const grant = rows[0];
    if (!grant || grant.client_id !== client.client_id) throw new InvalidGrantError("That sign-in code is not valid any more.");
    if (redirectUri && redirectUri !== grant.data.redirectUri) throw new InvalidGrantError("The redirect address does not match.");
    logger.info({ clientId: client.client_id }, "Claude connector signed in");
    return issueTokens(client.client_id, { scopes: (grant.data.scopes as string[]) ?? [MCP_SCOPE], resource: (grant.data.resource as string | null) ?? null });
  },

  async exchangeRefreshToken(client, refreshToken) {
    await ready();
    // Rotation: the old refresh token stops working the moment it is used.
    const { rows } = await pool.query<{ client_id: string; data: Record<string, unknown> }>(
      `UPDATE mcp_grants SET revoked_at = now()
        WHERE secret_hash = $1 AND kind = 'refresh' AND revoked_at IS NULL AND expires_at > now()
        RETURNING client_id, data`,
      [hashSecret(refreshToken)],
    );
    const grant = rows[0];
    if (!grant || grant.client_id !== client.client_id) throw new InvalidGrantError("Please connect Claude again.");
    return issueTokens(client.client_id, { scopes: (grant.data.scopes as string[]) ?? [MCP_SCOPE], resource: (grant.data.resource as string | null) ?? null });
  },

  async verifyAccessToken(token): Promise<AuthInfo> {
    await ready();
    const grant = await findGrant(token, "access");
    if (!grant) throw new InvalidTokenError("Signed out. Connect Claude again.");
    const resource = typeof grant.data.resource === "string" ? new URL(grant.data.resource) : undefined;
    return {
      token,
      clientId: grant.client_id,
      scopes: (grant.data.scopes as string[]) ?? [MCP_SCOPE],
      expiresAt: Math.floor(grant.expires_at.getTime() / 1000),
      ...(resource ? { resource } : {}),
    };
  },

  async revokeToken(_client, request: OAuthTokenRevocationRequest) {
    await ready();
    await pool.query(`UPDATE mcp_grants SET revoked_at = now() WHERE secret_hash = $1 AND revoked_at IS NULL`, [hashSecret(request.token)]);
  },
};

/** For Settings: is Claude connected, and since when. */
export async function connectorStatus(): Promise<{ connected: boolean; since: string | null; lastUsed: string | null }> {
  if (!(await ensureMcpTables())) return { connected: false, since: null, lastUsed: null };
  const { rows } = await pool.query<{ since: Date | null; last: Date | null; live: string }>(
    `SELECT min(created_at) FILTER (WHERE kind = 'refresh') AS since, max(created_at) FILTER (WHERE kind = 'access') AS last,
            count(*) FILTER (WHERE kind = 'refresh' AND revoked_at IS NULL AND expires_at > now()) AS live
       FROM mcp_grants WHERE revoked_at IS NULL OR kind = 'access'`,
  );
  const row = rows[0];
  const connected = Number(row?.live ?? 0) > 0;
  return { connected, since: connected ? (row?.since?.toISOString() ?? null) : null, lastUsed: row?.last?.toISOString() ?? null };
}

/** Disconnects Claude everywhere: every code, access and refresh token stops working now. */
export async function revokeAllConnectorAccess(): Promise<number> {
  await ready();
  const { rowCount } = await pool.query(`UPDATE mcp_grants SET revoked_at = now() WHERE revoked_at IS NULL`);
  return rowCount ?? 0;
}
