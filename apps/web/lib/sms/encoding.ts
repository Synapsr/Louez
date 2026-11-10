/**
 * How an SMS is encoded and split into segments, as the network does it
 * (after Twilio's message-segment-calculator, SegmentedMessage.ts).
 *
 * - A text of characters from the GSM 03.38 tables is GSM 7-bit: 7 bits a
 *   character, 14 for one of the extension table (an escape, then the
 *   character). Any other character makes the whole text UCS-2: 16 bits per
 *   UTF-16 code unit, so 32 for an emoji outside the basic plane.
 * - One SMS carries 1120 bits: 160 GSM 7-bit characters or 70 UCS-2 units.
 *   A longer text is sent in segments of 1072 bits each (a header takes 48):
 *   153 characters or 67 units, and a character (an escape pair, a surrogate
 *   pair, a whole emoji) is never split between two segments.
 *
 * Louez counts one SMS of the store's quota per message, whatever its
 * segments: a message is held to `SMS_MAX_SEGMENTS`, so that stays close to
 * what the provider bills.
 */

/** The GSM 03.38 basic table, in one character each. */
const GSM_BASIC_CHARS = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
/** The GSM 03.38 extension table: each is sent as an escape and the character. */
const GSM_EXTENDED_CHARS = new Set("\f^{}\\[~]|€");

/** The most segments one message may take. */
export const SMS_MAX_SEGMENTS = 3;

const SINGLE_SMS_BITS = 1120;
const SEGMENT_BITS = 1120 - 48;

/** What ends a text cut to fit: GSM 7-bit, so it never makes a text UCS-2. */
const ELLIPSIS = "...";

const isGsmChar = (char: string) => GSM_BASIC_CHARS.has(char) || GSM_EXTENDED_CHARS.has(char);

/** Whether the text needs UCS-2: a character outside the GSM 7-bit tables. */
export function requiresUnicode(text: string): boolean {
  for (const char of text) {
    if (!isGsmChar(char)) return true;
  }
  return false;
}

/** The text's characters as a reader sees them: an emoji and its modifiers are one. */
const graphemes = (text: string): string[] =>
  Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) =>
    String(part.segment),
  );

/** What one character costs, in bits. */
function graphemeBits(grapheme: string, unicode: boolean): number {
  if (unicode) return 16 * grapheme.length;
  let bits = 0;
  for (const char of grapheme) bits += GSM_EXTENDED_CHARS.has(char) ? 14 : 7;
  return bits;
}

/**
 * How many segments characters of these sizes take, none split between two.
 * A character bigger than a segment (a letter under hundreds of combining
 * marks) cannot be kept whole: it starts a segment and takes as many as its
 * size needs.
 */
function packedSegments(bits: readonly number[]): number {
  const total = bits.reduce((sum, size) => sum + size, 0);
  if (total <= SINGLE_SMS_BITS) return 1;
  let segments = 0;
  // The space left in the current segment: none before the first.
  let free = 0;
  for (const size of bits) {
    if (size > SEGMENT_BITS) {
      const spans = Math.ceil(size / SEGMENT_BITS);
      segments += spans;
      free = spans * SEGMENT_BITS - size;
    } else if (size > free) {
      segments += 1;
      free = SEGMENT_BITS - size;
    } else {
      free -= size;
    }
  }
  return segments;
}

/** How many segments the text takes. */
export function smsSegments(text: string): number {
  const unicode = requiresUnicode(text);
  return packedSegments(graphemes(text).map((grapheme) => graphemeBits(grapheme, unicode)));
}

/**
 * The text held to `maxSegments`: unchanged when it fits, else its longest
 * start that fits with "..." after it, cut after the last whole word (or the
 * last whole character, in a long word). Never cuts a character in half.
 */
export function fitSmsSegments(text: string, maxSegments: number = SMS_MAX_SEGMENTS): string {
  if (smsSegments(text) <= maxSegments) return text;
  const unicode = requiresUnicode(text);
  const characters = graphemes(text);
  const bits = characters.map((grapheme) => graphemeBits(grapheme, unicode));
  const ellipsisBits = graphemes(ELLIPSIS).map((grapheme) => graphemeBits(grapheme, unicode));
  const fits = (count: number) =>
    packedSegments([...bits.slice(0, count), ...ellipsisBits]) <= maxSegments;

  // The longest start that fits with the ellipsis: fitting only shrinks as it
  // grows. It stops before a character bigger than a segment, which is left out.
  const oversized = bits.findIndex((size) => size > SEGMENT_BITS);
  let low = 0;
  let high = oversized === -1 ? characters.length : oversized;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  let kept = characters.slice(0, low);
  // Back to the last space, unless that drops most of the text (one long word).
  const lastSpace = kept.findLastIndex((grapheme) => /^\s+$/.test(grapheme));
  if (lastSpace > kept.length * 0.7) kept = kept.slice(0, lastSpace);
  return `${kept.join("").trimEnd()}${ELLIPSIS}`;
}
