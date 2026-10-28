import { listForSync } from "./mail-repo";
import { logger } from "./logger";
import { isWhatsappEnabled, sendTemplate, toWhatsappNumber } from "./whatsapp-client";

/**
 * Getting Book & Pay messages out, over whatever is already set up.
 *
 * EMAIL goes through the mailbox the owner already connected in the console
 * for reading OTA emails (mail_accounts). An app password that can read over
 * IMAP can send over SMTP, so there is no new credential to manage; the SMTP
 * host is derived from the IMAP one (imap.gmail.com -> smtp.gmail.com).
 * nodemailer is loaded on demand, never at startup — the same rule as the
 * IMAP adapter (see mail-runner.ts): a mail problem must not stop the site.
 *
 * WHATSAPP goes through the Cloud API only when it is configured AND an
 * approved template name for that message is set. Meta refuses free text to
 * a number that has not messaged first, so without a template the honest
 * answer is "not sent", and the console offers a wa.me link instead.
 *
 * Every function here resolves to true/false. None of them throws: a failed
 * notification must never undo a confirmed booking or a submitted payment.
 */

function smtpHostFor(imapHost: string): string {
  const host = imapHost.trim().toLowerCase();
  if (host.startsWith("imap.")) return `smtp.${host.slice(5)}`;
  if (host === "outlook.office365.com") return "smtp.office365.com";
  return host;
}

export async function sendEmail(
  to: string | null,
  subject: string,
  text: string,
  attachments?: Array<{ filename: string; content: Buffer | Uint8Array; contentType: string }>,
): Promise<boolean> {
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return false;

  try {
    const [account] = await listForSync();
    if (!account) {
      logger.info("No mailbox connected; skipping Book & Pay email");
      return false;
    }

    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: smtpHostFor(account.host),
      port: 465,
      secure: true,
      auth: { user: account.username, pass: account.password },
    });

    await transport.sendMail({
      from: `Raj Kuthir Homestays <${account.username}>`,
      to,
      subject,
      text,
      ...(attachments?.length
        ? { attachments: attachments.map((file) => ({ ...file, content: Buffer.from(file.content) })) }
        : {}),
    });
    return true;
  } catch (error) {
    // Never log the recipient or the body: both carry guest details.
    logger.error({ err: error instanceof Error ? error.message : error }, "Book & Pay email failed");
    return false;
  }
}

/** Where owner alerts go: OWNER_ALERT_EMAIL, else the connected mailbox itself. */
export async function ownerEmail(): Promise<string | null> {
  const configured = process.env["OWNER_ALERT_EMAIL"]?.trim();
  if (configured) return configured;
  try {
    const [account] = await listForSync();
    return account?.username ?? null;
  } catch {
    return null;
  }
}

/**
 * A WhatsApp template send, if the Cloud API and the named template are both
 * configured. `templateEnv` names the env var holding the approved template.
 */
export async function sendWhatsappTemplate(
  phone: string | null | undefined,
  templateEnv: string,
  params: string[],
): Promise<boolean> {
  const templateName = process.env[templateEnv]?.trim();
  const to = toWhatsappNumber(phone);
  if (!isWhatsappEnabled() || !templateName || !to) return false;

  const result = await sendTemplate({ to, templateName, params }).catch(() => null);
  if (!result?.ok) {
    logger.warn({ templateEnv, error: result && !result.ok ? result.error : "threw" }, "Book & Pay WhatsApp send failed");
    return false;
  }
  return true;
}
