/**
 * Plain-text projections of editor HTML for meta descriptions and
 * structured data.
 */

// Tags that end a line in the editor. Their boundaries become a space so
// two paragraphs never fuse ("Concarneau.Depuis 2019").
const BLOCK_BOUNDARY =
  /<\/?(?:p|div|br|li|ul|ol|h[1-6]|blockquote|tr|td|th|section|article)\b[^>]*>/gi;

/** Strip HTML tags, keeping one space where a block used to break the text. */
export const stripHtml = (html: string): string =>
  html
    .replace(BLOCK_BOUNDARY, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Cut a text to `maxLength` characters, ellipsis included. */
export const truncateText = (text: string, maxLength: number): string =>
  text.length <= maxLength ? text : `${text.substring(0, maxLength - 3).trim()}...`;
