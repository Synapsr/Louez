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
