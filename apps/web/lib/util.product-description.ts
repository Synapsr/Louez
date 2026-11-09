import { sanitizeRichTextHtml } from "@louez/utils/sanitize-rich-text";

/**
 * The allow-list sanitiser lives in `@louez/utils` so the API services
 * sanitise on write with the same rules the storefront applies on read. It
 * runs on the server only: a client component gets HTML sanitised by its
 * server parent. This name is kept for the existing importers.
 */
export const sanitizeProductDescriptionHtml = sanitizeRichTextHtml;
