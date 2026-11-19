/**
 * Sending email through the Gmail API over HTTPS (port 443).
 *
 * Why: Railway's Free, Trial and Hobby plans block outbound SMTP (ports 25,
 * 465 and 587), so smtp.gmail.com never answers from production — the
 * connection is dropped and nodemailer times out. The same Gmail account the
 * owner already uses for the IMAP booking sync can send over HTTPS instead,
 * at no cost, from the same address, with the mail landing in its Sent folder.
 *
 * Credentials are an OAuth client and a refresh token with only the
 * gmail.send scope (it can send, not read). They live in env vars and are
 * never logged. Errors are logged by status and Google's short reason only:
 * never the recipient, subject or body.
 */

export type Attachment = { filename: string; content: Buffer | Uint8Array; contentType: string };

/** The message as nodemailer describes it; the same object feeds SMTP or the Gmail API. */
export function mailFor(from: string | null, to: string, subject: string, text: string, attachments?: Attachment[]) {
  return {
    ...(from ? { from: `Raj Kuthir Homestays <${from}>` } : {}),
    to,
    subject,
    text,
    ...(attachments?.length
      ? { attachments: attachments.map((file) => ({ ...file, content: Buffer.from(file.content) })) }
      : {}),
  };
}

/** RFC 822 bytes for the Gmail API, built by nodemailer's own composer. */
export async function rawMessage(mail: ReturnType<typeof mailFor>): Promise<Buffer> {
  const { default: MailComposer } = await import("nodemailer/lib/mail-composer/index.js");
  return new MailComposer(mail).compile().build();
}

export type GmailConfig = { clientId: string; clientSecret: string; refreshToken: string };

export function gmailConfig(env: Record<string, string | undefined> = process.env): GmailConfig | null {
  const clientId = env["GMAIL_CLIENT_ID"]?.trim();
  const clientSecret = env["GMAIL_CLIENT_SECRET"]?.trim();
  const refreshToken = env["GMAIL_REFRESH_TOKEN"]?.trim();
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string; retryable: boolean };

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type GmailDeps = {
  fetch?: FetchLike;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Tries in all, including the first. */
  attempts?: number;
  /** First backoff; doubles each retry. */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

let cachedToken: { value: string; expiresAt: number; key: string } | null = null;

/** For tests: forget the cached access token. */
export function resetGmailToken(): void {
  cachedToken = null;
}

/** Google's short reason ("invalid_grant", "Mail service not enabled"), never anything we sent. */
async function reasonOf(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { error?: string | { message?: string; status?: string }; error_description?: string }
    | null;
  const error = body?.error;
  const reason = typeof error === "string" ? error : (error?.status ?? error?.message);
  return `HTTP ${response.status}${reason ? ` ${String(reason).slice(0, 120)}` : ""}`;
}

/** 408, 429 and 5xx are worth another go; any other 4xx will fail the same way again. */
const retryableStatus = (status: number) => status === 408 || status === 429 || status >= 500;

async function timedFetch(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

async function accessToken(config: GmailConfig, deps: Required<Pick<GmailDeps, "fetch" | "timeoutMs" | "now">>): Promise<SendResult> {
  const key = `${config.clientId}:${config.refreshToken.slice(-8)}`;
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt > deps.now()) return { ok: true, id: cachedToken.value };

  const response = await timedFetch(
    deps.fetch,
    TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    },
    deps.timeoutMs,
  );
  if (!response.ok) return { ok: false, error: `token ${await reasonOf(response)}`, retryable: retryableStatus(response.status) };
  const body = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!body?.access_token) return { ok: false, error: "token response had no access_token", retryable: true };
  // Refresh a minute early so a token never expires mid-send.
  cachedToken = { value: body.access_token, expiresAt: deps.now() + Math.max(60, (body.expires_in ?? 3600) - 60) * 1000, key };
  return { ok: true, id: body.access_token };
}

async function sendOnce(config: GmailConfig, raw: Buffer, deps: Required<Pick<GmailDeps, "fetch" | "timeoutMs" | "now">>): Promise<SendResult> {
  try {
    const token = await accessToken(config, deps);
    if (!token.ok) return token;
    const response = await timedFetch(
      deps.fetch,
      SEND_URL,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token.id}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: raw.toString("base64url") }),
      },
      deps.timeoutMs,
    );
    if (response.status === 401) {
      // The access token was revoked or expired early: fetch a new one next try.
      resetGmailToken();
      return { ok: false, error: `send ${await reasonOf(response)}`, retryable: true };
    }
    if (!response.ok) return { ok: false, error: `send ${await reasonOf(response)}`, retryable: retryableStatus(response.status) };
    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: body?.id ?? "unknown" };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, error: timedOut ? "timeout" : `network ${error instanceof Error ? error.message.slice(0, 120) : "error"}`, retryable: true };
  }
}

/**
 * Sends one already-built MIME message (RFC 822 bytes). Retries timeouts,
 * network errors, 429 and 5xx with exponential backoff; gives up at once on
 * anything that will not change (bad credentials, a rejected message).
 */
export async function sendViaGmail(config: GmailConfig, raw: Buffer, deps: GmailDeps = {}): Promise<SendResult> {
  const resolved = {
    fetch: deps.fetch ?? ((url: string, init: RequestInit) => fetch(url, init)),
    timeoutMs: deps.timeoutMs ?? 15_000,
    now: deps.now ?? Date.now,
  };
  const attempts = deps.attempts ?? 3;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let wait = deps.backoffMs ?? 1_000;

  let last: SendResult = { ok: false, error: "not attempted", retryable: false };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await sendOnce(config, raw, resolved);
    if (last.ok || !last.retryable || attempt === attempts) return last;
    await sleep(wait);
    wait *= 2;
  }
  return last;
}
