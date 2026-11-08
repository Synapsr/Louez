import { sanitizeProductDescriptionHtml } from "@/lib/util.product-description";

export { sanitizeProductDescriptionHtml };

/**
 * Sanitises HTML written in the dashboard rich-text editor before it is
 * rendered with `dangerouslySetInnerHTML`: store description, product
 * description, terms, legal notice. Same allow-list as the product
 * description (paragraphs, headings, lists, emphasis, underline, safe
 * links); a tag outside it is dropped and its text kept. It runs on the
 * server only (the parser stays out of client bundles).
 *
 * `null`/`undefined` collapse to an empty string so callers can pass the
 * raw column through.
 */
export const sanitizeRichTextHtml = (html: string | null | undefined): string =>
  html ? sanitizeProductDescriptionHtml(html) : "";

/** Whether editor HTML shows any text; shared with the API (`@louez/utils`). */
export { hasRichTextContent } from "@louez/utils";
