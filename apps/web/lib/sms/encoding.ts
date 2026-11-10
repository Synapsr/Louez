/**
 * How an SMS is encoded and split. A text of GSM 7-bit characters fits 160
 * of them in one SMS, 153 per segment once split (an extended character
 * counts twice); any other character makes the whole text UCS-2: 70 code
 * units in one SMS, 67 per segment. Louez counts one SMS of the store's quota
 * per message, whatever its segments: a message is held to
 * `SMS_MAX_SEGMENTS` so that stays close to what the provider bills.
 */

/** GSM 7-bit character set (basic + extended). */
const GSM_BASIC_CHARS =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED_CHARS = "^{}\\[~]|€";

/** The most segments one message may take. */
export const SMS_MAX_SEGMENTS = 3;

/** What ends a text cut to fit: GSM 7-bit, so it never changes the encoding. */
const ELLIPSIS = "...";

/** Whether the text needs UCS-2: a character outside the GSM 7-bit set. */
export function requiresUnicode(text: string): boolean {
  for (const char of text) {
    if (!GSM_BASIC_CHARS.includes(char) && !GSM_EXTENDED_CHARS.includes(char)) return true;
  }
  return false;
}

/** What one character costs: septets in GSM 7-bit, UTF-16 code units in UCS-2. */
const charCost = (char: string, unicode: boolean) =>
  unicode ? char.length : GSM_EXTENDED_CHARS.includes(char) ? 2 : 1;

const textCost = (text: string, unicode: boolean) => {
  let cost = 0;
  for (const char of text) cost += charCost(char, unicode);
  return cost;
};

/** How many segments the text takes. */
export function smsSegments(text: string): number {
  const unicode = requiresUnicode(text);
  const cost = textCost(text, unicode);
  const single = unicode ? 70 : 160;
  const perSegment = unicode ? 67 : 153;
  return cost <= single ? 1 : Math.ceil(cost / perSegment);
}

/**
 * The text held to `maxSegments`: unchanged when it fits, else cut at the
 * last word that fits (or the last whole character, in a long word) and
 * ended with "...". Never cuts a character in half.
 */
export function fitSmsSegments(text: string, maxSegments: number = SMS_MAX_SEGMENTS): string {
  if (smsSegments(text) <= maxSegments) return text;
  const unicode = requiresUnicode(text);
  const budget = maxSegments * (unicode ? 67 : 153) - textCost(ELLIPSIS, unicode);

  let kept = "";
  let cost = 0;
  for (const char of text) {
    const next = cost + charCost(char, unicode);
    if (next > budget) break;
    kept += char;
    cost = next;
  }
  // Back to the last space, unless that drops most of the text (one long word).
  const lastSpace = kept.search(/\s\S*$/);
  if (lastSpace > kept.length * 0.7) kept = kept.slice(0, lastSpace);
  return `${kept.trimEnd()}${ELLIPSIS}`;
}
