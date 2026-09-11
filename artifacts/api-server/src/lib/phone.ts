/**
 * What counts as a phone number we can ring back.
 *
 * Indian mobiles are ten digits starting 6-9, optionally written with +91, a
 * leading 0, spaces, dashes or brackets. Anything else — a landline with no
 * code, nine digits, a bot's "1234567890" — is refused rather than stored: an
 * enquiry nobody can answer is worse than no enquiry, because it sits in the
 * list looking like work.
 *
 * MOBILE_PATTERN is the single source of truth. The browser gets it as the
 * `pattern` attribute on the input so a guest is told before they submit; the
 * server re-checks it because a browser rule stops honest mistakes, not
 * scripts. A test asserts the two agree on a table of real numbers.
 *
 * This lives in its own file, with no imports, so that test can load it
 * without dragging in Express and a database connection.
 */
export const MOBILE_PATTERN = "(\\+?91[- ]?|0)?[6-9][0-9]{9}";

const MOBILE = new RegExp(`^(?:${MOBILE_PATTERN})$`);

/**
 * The number with the punctuation people type stripped out, or null when it
 * is not a mobile number at all.
 */
export function normaliseMobile(raw: string): string | null {
  const trimmed = raw.replace(/[()\s.-]/g, "");
  return MOBILE.test(trimmed) ? trimmed : null;
}
