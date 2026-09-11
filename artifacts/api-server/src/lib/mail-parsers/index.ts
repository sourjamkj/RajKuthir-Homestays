import { handlesSender as handlesGoMmt, parseGoMmtVoucher } from "./gomt.ts";
import type { ParsedVoucher } from "./gomt.ts";

export type { ParsedVoucher };

/**
 * Which parser understands mail from which sender.
 *
 * Adding a channel means adding a file beside gomt.ts that exports the same
 * two functions, and one line here. Nothing else in the pipeline changes —
 * the mailbox reader, the cron and the admin screen are all channel-agnostic
 * on purpose, because the thing that changes every year is the email layout,
 * not the plumbing.
 */
export type MailParser = {
  /** The channel this parser speaks for, for logs and the admin screen. */
  name: string;
  handlesSender: (from: string) => boolean;
  parse: (input: {
    from: string;
    subject: string;
    body: string;
  }) => ParsedVoucher | null;
};

export const PARSERS: MailParser[] = [
  {
    name: "Go-MMT (MakeMyTrip / Goibibo)",
    handlesSender: handlesGoMmt,
    parse: ({ from, subject, body }) => parseGoMmtVoucher(subject, from, body),
  },
];

/** The first parser that claims the sender, or null when nobody does. */
export function parserFor(from: string): MailParser | null {
  return PARSERS.find((parser) => parser.handlesSender(from)) ?? null;
}

/**
 * Parse one message, or return null.
 *
 * Null covers both "no parser wants this sender" and "the parser looked and
 * found nothing it recognised" — the caller treats them the same way, by
 * leaving the message alone. A mailbox contains far more mail that is not a
 * booking than mail that is, so not-a-booking is the normal case and must
 * never be logged as a failure.
 */
export function parseMessage(input: {
  from: string;
  subject: string;
  body: string;
}): { parser: MailParser; voucher: ParsedVoucher } | null {
  const parser = parserFor(input.from);
  if (!parser) return null;

  const voucher = parser.parse(input);
  return voucher ? { parser, voucher } : null;
}
