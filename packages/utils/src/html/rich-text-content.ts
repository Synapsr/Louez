/**
 * Deepest nesting a rich text may have. The editor nests a few levels at
 * most (a list in a quote). htmlparser2, the sanitiser's parser, keeps open
 * tags in an array it unshifts, so each open tag costs the depth below it: a
 * pile of unclosed tags costs the square of its length (100 KB of `<b>`:
 * 76 ms to parse, then as much again to sanitise).
 */
export const RICH_TEXT_MAX_DEPTH = 256;

const TAG_PATTERN = /<[^>]*>/g;
const ENTITY_SPACE_PATTERN = /&nbsp;|&#160;|&#xa0;/gi;

/**
 * True when editor HTML carries visible text: an editor that was opened and
 * closed leaves `<p></p>` (or `<p>&nbsp;</p>`) behind, and a heading alone
 * should not summon a whole "Description" section.
 */
export const hasRichTextContent = (html: string | null | undefined): boolean => {
  if (!html) return false;
  return (
    html
      .replace(TAG_PATTERN, "")
      .replace(ENTITY_SPACE_PATTERN, " ")
      .replace(/\u00a0/g, " ")
      .trim().length > 0
  );
};
