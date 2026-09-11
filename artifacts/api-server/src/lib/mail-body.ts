/**
 * Turning a received email into the text a parser can read.
 *
 * OTA booking mail is HTML — nested tables, inline styles, tracking pixels —
 * and often carries no text/plain part at all. The parsers work on flat text,
 * so something has to do the conversion, and it has to do it the same way
 * every time or a parser that worked last month stops matching.
 *
 * The rule here is that table structure becomes punctuation: a cell boundary
 * is " | " and a row boundary is a newline. That is exactly the shape the
 * Go-MMT fixtures have, because a label and its value live in adjacent cells
 * and a parser needs to know they were adjacent. Throwing the tags away
 * without leaving a mark would run "CHECK-IN" straight into "CHECK-OUT".
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rupee: "₹",
  inr: "₹",
};

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    )
    .replace(/&([a-z]+);/gi, (whole, name: string) => {
      const found = ENTITIES[name.toLowerCase()];
      return found ?? whole;
    });
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      // Anything that is not content, removed with its contents.
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      // Structure becomes punctuation, before the tags disappear.
      .replace(/<\/(td|th)>/gi, " | ")
      .replace(/<\/(tr|p|div|h[1-6]|li)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    // Collapse the whitespace the tags left behind, but keep line breaks:
    // a parser that looks for a value "on the next line" still can.
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n *(?:\n *)+/g, "\n")
    .replace(/^ +| +$/gm, "")
    .trim();
}

/**
 * The best text available from a parsed message.
 *
 * text/plain wins when the sender provided one — it is what they meant the
 * message to say. Otherwise the HTML part is converted. An email with neither
 * yields an empty string, and the parsers will decline it, which is correct:
 * a message with no readable body is not a booking we can trust.
 */
export function bodyText(message: {
  text?: string | null;
  html?: string | false | null;
}): string {
  const plain = message.text?.trim();
  if (plain) return plain;

  const html = typeof message.html === "string" ? message.html.trim() : "";
  return html ? htmlToText(html) : "";
}
