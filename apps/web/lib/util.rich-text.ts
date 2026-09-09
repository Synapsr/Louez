import { sanitizeProductDescriptionHtml } from "@/lib/util.product-description";

export { sanitizeProductDescriptionHtml };

/**
 * Sanitises HTML written in the dashboard rich-text editor before it is
 * rendered with `dangerouslySetInnerHTML`: store description, product
 * description, terms, legal notice. Same allow-list as the product
 * description (paragraphs, headings, lists, emphasis, underline, safe
 * links); a tag outside it is dropped and its text kept.
 *
 * `null`/`undefined` collapse to an empty string so callers can pass the
 * raw column through.
 */
export const sanitizeRichTextHtml = (html: string | null | undefined): string =>
  html ? sanitizeProductDescriptionHtml(html) : "";

const TAG_PATTERN = /<[^>]*>/g;
const ENTITY_SPACE_PATTERN = /&nbsp;|&#160;|&#xa0;/gi;

/**
 * True when the HTML carries visible text — an editor that was opened and
 * closed leaves `<p></p>` behind, and a heading alone should not summon a
 * whole "Description" section.
 */
export const hasRichTextContent = (html: string | null | undefined): boolean => {
  if (!html) {
    return false;
  }

  return html.replace(TAG_PATTERN, "").replace(ENTITY_SPACE_PATTERN, " ").trim().length > 0;
};
