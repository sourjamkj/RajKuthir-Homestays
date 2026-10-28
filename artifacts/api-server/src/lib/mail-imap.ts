import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import { logger } from "./logger";
import { bodyText } from "./mail-body";
import type { MailAttachment, MailboxRead, MailMessage, SyncableAccount } from "./mail-sync";

/**
 * The only file that talks IMAP.
 *
 * Everything interesting about reading a mailbox is in mail-sync.ts, which is
 * testable. This is the boring half: open a connection, ask for the messages
 * after a UID, hand back plain objects, always close.
 *
 * Two choices worth knowing about:
 *
 * 1. It asks for `uid > sinceUid` rather than for unseen mail. Read state
 *    belongs to the person reading the mailbox, not to us — marking a booking
 *    email as read behind the owner's back, or skipping one because they
 *    opened it on their phone first, are both wrong.
 *
 * 2. It reads at most MAX_PER_RUN messages. A first run against a mailbox with
 *    ten years of mail in it should take several short runs rather than one
 *    that times out, and the high-water mark means each run resumes where the
 *    last stopped.
 */

const MAX_PER_RUN = 200;
const CONNECT_TIMEOUT_MS = 20_000;

/**
 * Raw RFC822 source in, readable text out.
 *
 * The raw source is MIME: base64 or quoted-printable, usually HTML-only for
 * these senders. simpleParser undoes the transfer encoding and hands back the
 * parts; bodyText picks the right one and flattens it the same way every time.
 * Handing a parser the raw source instead would feed it base64 and it would
 * politely find no booking in it.
 */
/** Largest PDF kept from an email; OTA vouchers are ~100 KB. */
const MAX_PDF_BYTES = 10 * 1024 * 1024;

async function readableBody(
  source: Buffer | string | undefined,
): Promise<{ body: string; attachments: MailAttachment[] }> {
  if (!source) return { body: "", attachments: [] };

  try {
    const parsed = await simpleParser(source);
    // PDFs only: the vouchers, cancellations and statements the OTAs send.
    const attachments = (parsed.attachments ?? [])
      .filter((file) => /pdf$/i.test(file.contentType ?? "") || /\.pdf$/i.test(file.filename ?? ""))
      .filter((file) => file.content && file.content.length <= MAX_PDF_BYTES)
      .map((file) => ({
        filename: file.filename || "document.pdf",
        contentType: "application/pdf",
        content: file.content,
      }));
    return { body: bodyText({ text: parsed.text, html: parsed.html }), attachments };
  } catch (error) {
    logger.warn({ err: error }, "Could not parse message body");
    return { body: "", attachments: [] };
  }
}

/** The sender as a bare address, which is what a parser matches on. */
function addressOf(envelopeFrom: Array<{ address?: string | null }> | undefined): string {
  return envelopeFrom?.[0]?.address ?? "";
}

export async function readMailbox(
  account: SyncableAccount,
  sinceUid: number,
): Promise<MailboxRead> {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: { user: account.username, pass: account.password },
    // imapflow logs the whole session at debug, credentials included.
    logger: false,
    socketTimeout: CONNECT_TIMEOUT_MS,
  });

  await client.connect();

  try {
    const lock = await client.getMailboxLock(account.folder);

    try {
      const mailbox = client.mailbox;
      const uidValidity =
        mailbox && typeof mailbox !== "boolean"
          ? String(mailbox.uidValidity)
          : "0";

      const messages: MailMessage[] = [];

      // `${n}:*` is IMAP for "from n to the end". A mailbox whose highest UID
      // is below n returns that one message, which the engine then filters
      // out by UID — hence the belt-and-braces check in syncAccount.
      const range = `${Math.max(sinceUid + 1, 1)}:*`;

      for await (const message of client.fetch(
        range,
        { uid: true, envelope: true, source: true },
        { uid: true },
      )) {
        if (messages.length >= MAX_PER_RUN) break;
        if (typeof message.uid !== "number" || message.uid <= sinceUid) continue;

        const { body, attachments } = await readableBody(message.source);
        messages.push({
          uid: message.uid,
          from: addressOf(message.envelope?.from),
          subject: message.envelope?.subject ?? "",
          body,
          attachments,
        });
      }

      logger.info(
        {
          account: account.label,
          folder: account.folder,
          fetched: messages.length,
          sinceUid,
        },
        "Mailbox read",
      );

      return { uidValidity, messages };
    } finally {
      lock.release();
    }
  } finally {
    // logout() is the polite close; if it fails the socket still has to go,
    // or a failed run leaks a connection the provider will eventually refuse.
    await client.logout().catch(() => client.close());
  }
}

/**
 * Every message in the folder from one sender's domain, oldest first — for a
 * one-off backfill when a new parser is added. Uses IMAP SEARCH so only the
 * matching messages are downloaded, never the whole mailbox.
 */
export async function readBySender(
  account: SyncableAccount,
  senderDomain: string,
  limit = 1000,
): Promise<MailMessage[]> {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: { user: account.username, pass: account.password },
    logger: false,
    socketTimeout: CONNECT_TIMEOUT_MS,
  });

  await client.connect();

  try {
    const lock = await client.getMailboxLock(account.folder);
    try {
      const found = await client.search({ from: senderDomain }, { uid: true });
      const uids = (Array.isArray(found) ? found : []).sort((a, b) => a - b).slice(-limit);
      if (uids.length === 0) return [];

      const messages: MailMessage[] = [];
      for await (const message of client.fetch(
        uids,
        { uid: true, envelope: true, source: true },
        { uid: true },
      )) {
        if (typeof message.uid !== "number") continue;
        const { body, attachments } = await readableBody(message.source);
        messages.push({
          uid: message.uid,
          from: addressOf(message.envelope?.from),
          subject: message.envelope?.subject ?? "",
          body,
          attachments,
        });
      }

      logger.info({ account: account.label, senderDomain, fetched: messages.length }, "Mailbox backfill read");
      return messages.sort((a, b) => a.uid - b.uid);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}
