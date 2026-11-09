/** Plain-text helpers for meta descriptions and structured data. */

/** Cut a text to `maxLength` characters, ellipsis included. */
export const truncateText = (text: string, maxLength: number): string =>
  text.length <= maxLength ? text : `${text.substring(0, maxLength - 3).trim()}...`;
