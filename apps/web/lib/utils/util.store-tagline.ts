const TAG_PATTERN = /<[^>]*>/g;
const ENTITY_SPACE_PATTERN = /&nbsp;|&#160;|&#xa0;/gi;
const WHITESPACE_PATTERN = /\s+/g;
const FIRST_SENTENCE_PATTERN = /^(.+?[.!?])(?=\s|$)/;
const MAX_TAGLINE_LENGTH = 140;

/**
 * The short line under the store name: the first sentence of the store
 * description, plain text, capped at 140 characters. Null when the
 * description is empty so the hero stays name-only.
 */
export const getStoreTagline = (description: string | null | undefined): string | null => {
  if (!description) return null;

  const text = description
    .replace(TAG_PATTERN, " ")
    .replace(ENTITY_SPACE_PATTERN, " ")
    .replace(WHITESPACE_PATTERN, " ")
    .trim();
  if (!text) return null;

  const sentence = FIRST_SENTENCE_PATTERN.exec(text)?.[1] ?? text;
  if (sentence.length <= MAX_TAGLINE_LENGTH) return sentence;

  const cut = sentence.slice(0, MAX_TAGLINE_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};
