import { hasRichTextContent } from "@louez/utils";
import { sanitizeRichText } from "@louez/utils/sanitize-rich-text";

import { TEXT_COLUMN_BYTES, settingsErrors } from "../contracts/settings";

/**
 * Editor HTML as the store's texts store it (description, tagline, terms,
 * legal notice), shared by the settings and the online store editor. Every
 * function here runs before the write takes the store's lock: parsing and
 * sanitising never hold it.
 */

/**
 * Sanitised editor HTML ready to store: refused when it nests deeper than
 * any editor writes, as sent or once sanitised, or when it would not fit its TEXT column (the
 * sanitiser escapes, so the stored value can be longer than what was sent).
 * `blankAsNull`: an editor left empty stores null.
 */
export function toStoredHtml(
  field: string,
  html: string,
  options: { blankAsNull: boolean },
): string | null {
  // Too deep as sent, or once sanitised (a line break becomes a `<br />`).
  const { html: sanitized, tooDeep } = sanitizeRichText(html);
  if (tooDeep) throw settingsErrors.textTooDeep(field);
  if (options.blankAsNull && !hasRichTextContent(sanitized)) return null;
  const bytes = Buffer.byteLength(sanitized, "utf8");
  if (bytes > TEXT_COLUMN_BYTES) throw settingsErrors.textTooLong(field, bytes);
  return sanitized;
}

/** Whether a text holds a tag: a `<` and a letter, then a `>` after it. One pass. */
function looksLikeHtml(text: string): boolean {
  const tag = /<[a-z]/i.exec(text);
  return tag !== null && text.indexOf(">", tag.index) !== -1;
}

/**
 * Editor HTML from what an agent sends: HTML is sanitised as the editor's
 * own; plain text becomes paragraphs (a blank line) and line breaks, so its
 * shape survives on the storefront, and its `<` and `>` stay characters.
 * Blank text is null.
 */
export function agentTextToStoredHtml(field: string, text: string | null): string | null {
  if (text === null) return null;
  const html = looksLikeHtml(text)
    ? text
    : text
        .trim()
        .split(/\n\s*\n/)
        .map((paragraph) => {
          // Text, not markup: its angle brackets are characters. An `&` is
          // left to the sanitiser, which keeps an entity written as one.
          const text = paragraph.trim().replaceAll("<", "&lt;").replaceAll(">", "&gt;");
          return `<p>${text.replaceAll("\n", "<br />")}</p>`;
        })
        .join("");
  return toStoredHtml(field, html, { blankAsNull: true });
}
