import { randomInt } from "node:crypto";

/**
 * Raj Kuthir's own booking reference — RK-17SEP-7K4MQ.
 *
 * This is the credential a guest types into /welcome, so it has to be
 * unguessable; it is read off a WhatsApp message and typed on a phone, so it
 * has to be short and unambiguous.
 *
 *   RK - <check-in as DDMMM> - <five random characters>
 *
 * The date half is for the OWNER's benefit: it makes a reference recognisable
 * at a glance in a WhatsApp thread, and sorts naturally in a list. It carries
 * no security and it is not how a booking is found — the random half does all
 * of that work.
 *
 * A reference NEVER changes once issued, including when a stay is moved. A
 * guest sent RK-17SEP-7K4MQ in August must still be able to use it if the
 * booking shifts to October; a reference that regenerated itself would break
 * every message already sent. The date in it is therefore a record of what the
 * booking looked like when it was created, not a live field.
 */

/**
 * No 0/O or 1/I/L to misread over a phone line, and no U — which is how random
 * strings turn rude. Thirty characters, so five of them give 24.3 million
 * possibilities per date. Paired with the lookup route's rate limit that puts
 * brute force out of reach.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const RANDOM_LENGTH = 5;

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

export function randomPart(length: number = RANDOM_LENGTH): string {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    // randomInt is uniform. Math.random() % ALPHABET.length would bias the
    // first two characters of the alphabet, which is exactly the kind of bug
    // that quietly shrinks a keyspace.
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/** "2026-09-17" -> "17SEP". Falls back rather than throwing on a bad date. */
export function datePart(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return "XXXXX";

  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${match[3]}${month}` : "XXXXX";
}

export function buildReference(checkIn: string): string {
  return `RK-${datePart(checkIn)}-${randomPart()}`;
}

/**
 * Comparison form. Case and punctuation are not part of a reference's
 * identity, so "rk 17sep 7k4mq", "RK-17SEP-7K4MQ" and "rk17sep7k4mq" are all
 * the same booking. Applied to both sides of every lookup.
 */
export function normaliseReference(raw: string): string {
  return raw.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

/** Cheap shape check, used to reject obvious nonsense before hitting the database. */
export function looksLikeReference(raw: string): boolean {
  return /^RK[0-9]{2}[A-Z]{3}[A-Z0-9]{4,6}$/.test(normaliseReference(raw));
}
