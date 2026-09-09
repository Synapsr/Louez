import { sanitizeRichTextHtml } from "@louez/utils";

/**
 * The allow-list sanitiser now lives in `@louez/utils` so the API services
 * sanitise on write with the same rules the storefront applies on read.
 * This name is kept for the existing importers.
 */
export const sanitizeProductDescriptionHtml = sanitizeRichTextHtml;
