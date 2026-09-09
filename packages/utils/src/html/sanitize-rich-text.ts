/**
 * Allow-list sanitiser for HTML written in the dashboard rich-text editor
 * (store description, product description, terms, legal notice). Runs on
 * write (API services) and on read (storefront), so a stored value is safe
 * whichever path produced it.
 */

const ALLOWED_TAGS = new Set([
  "a",
  "blockquote",
  "br",
  "em",
  "h1",
  "h2",
  "h3",
  "hr",
  "li",
  "ol",
  "p",
  "s",
  "strong",
  "u",
  "ul",
]);

const VOID_TAGS = new Set(["br", "hr"]);
const HTML_TAG_PATTERN = /<[^>]*>/g;
const HREF_PATTERN = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;

const escapeHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const escapeHtmlAttribute = (value: string): string =>
  escapeHtml(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const decodeCodePoint = (value: string, radix: 10 | 16): string => {
  const codePoint = Number.parseInt(value, radix);

  if (!Number.isSafeInteger(codePoint) || codePoint > 0x10ffff) {
    return "�";
  }

  return String.fromCodePoint(codePoint);
};

const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&apos;": "'",
  "&gt;": ">",
  "&lt;": "<",
  "&quot;": '"',
};

const decodeHtmlEntities = (value: string): string =>
  value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|amp|apos|gt|lt|quot);/gi,
    (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
      if (decimal) {
        return decodeCodePoint(decimal, 10);
      }

      if (hexadecimal) {
        return decodeCodePoint(hexadecimal, 16);
      }

      return NAMED_ENTITIES[entity.toLowerCase()] ?? entity;
    },
  );

const getSafeHref = (tag: string): string | null => {
  const hrefMatch = tag.match(HREF_PATTERN);
  const rawHref = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3];

  if (!rawHref) {
    return null;
  }

  const href = decodeHtmlEntities(rawHref).trim();

  if (!/^https?:\/\//i.test(href)) {
    return null;
  }

  return escapeHtmlAttribute(href);
};

// A tag name follows `<` (or `</`) directly and starts with a letter, as in
// the HTML parser; `a < b > c` in plain text stays text.
const TAG_NAME_PATTERN = /^<(\/?)([a-z][a-z\d]*)(?:\s[^>]*)?\s*\/?\s*>$/i;

const sanitizeTag = (tag: string): string => {
  const tagMatch = tag.match(TAG_NAME_PATTERN);

  if (!tagMatch) {
    return escapeHtml(tag);
  }

  const isClosingTag = tagMatch[1] === "/";
  const tagName = tagMatch[2]?.toLowerCase();

  if (!tagName) {
    return escapeHtml(tag);
  }

  if (!ALLOWED_TAGS.has(tagName)) {
    return "";
  }

  if (VOID_TAGS.has(tagName)) {
    return isClosingTag ? "" : `<${tagName}>`;
  }

  if (isClosingTag) {
    return `</${tagName}>`;
  }

  if (tagName === "a") {
    const href = getSafeHref(tag);
    return href ? `<a href="${href}" rel="noopener noreferrer">` : "<a>";
  }

  return `<${tagName}>`;
};

/**
 * Keeps the editor's markup (allow-list above, attributes stripped except a
 * safe `href`) and drops every other tag while keeping its text, so a pasted
 * `<span style>` or `<code>` never shows up as literal angle brackets. Text
 * that is not a tag is escaped; plain-text line breaks become `<br>`.
 */
export const sanitizeRichTextHtml = (html: string): string => {
  let sanitizedHtml = "";
  let lastIndex = 0;

  for (const match of html.matchAll(HTML_TAG_PATTERN)) {
    const matchIndex = match.index;

    sanitizedHtml += escapeHtml(html.slice(lastIndex, matchIndex)).replaceAll(/\r?\n/g, "<br>");
    sanitizedHtml += sanitizeTag(match[0]);
    lastIndex = matchIndex + match[0].length;
  }

  sanitizedHtml += escapeHtml(html.slice(lastIndex)).replaceAll(/\r?\n/g, "<br>");

  return sanitizedHtml;
};
