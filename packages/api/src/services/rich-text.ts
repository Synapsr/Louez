import { hasRichTextContent } from "@louez/utils";
import { sanitizeRichTextHtml } from "@louez/utils/sanitize-rich-text";

import { TEXT_COLUMN_BYTES, settingsErrors } from "../contracts/settings";

/**
 * Editor HTML as the store's texts store it (description, tagline, terms,
 * legal notice), shared by the settings and the online store editor.
 */

/** Editor HTML: null when the editor is empty, sanitised otherwise. */
export const toStoredRichText = (html: string): string | null => {
  const sanitized = sanitizeRichTextHtml(html);
  return hasRichTextContent(sanitized) ? sanitized : null;
};

/**
 * Sanitised editor HTML, refused when it would not fit its TEXT column: the
 * sanitiser escapes, so the stored value can be longer than what was sent.
 */
export function fitTextColumn(field: string, html: string | null): string | null {
  if (html === null) return null;
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > TEXT_COLUMN_BYTES) throw settingsErrors.textTooLong(field, bytes);
  return html;
}

/**
 * Editor HTML from what a caller sends: HTML is sanitised as the editor's
 * own; plain text becomes paragraphs (a blank line) and line breaks, so an
 * agent's text keeps its shape on the storefront. The sanitiser escapes the
 * text itself. Blank text is null.
 */
export function toEditorHtml(text: string | null): string | null {
  if (text === null) return null;
  const html = /<[a-z][\s\S]*>/i.test(text)
    ? text
    : text
        .trim()
        .split(/\n\s*\n/)
        .map((paragraph) => `<p>${paragraph.trim().replace(/\n/g, "<br />")}</p>`)
        .join("");
  return toStoredRichText(html);
}
