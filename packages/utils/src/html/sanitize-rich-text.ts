/**
 * Allow-list sanitiser for HTML written in the dashboard rich-text editor
 * (store description, product description, terms, legal notice). Runs on
 * write (API services) and on read (storefront), so a stored value is safe
 * whichever path produced it. It is idempotent: sanitising its own output
 * changes nothing, so a value saved again and again, then rendered, keeps
 * its text as it was (`&amp;` stays one `&`).
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
/**
 * A tag starts with `<` then a letter (or `</` then a letter), as for the
 * HTML parser; `a < b` stays text. A comment is matched whole, to be dropped.
 */
const HTML_TAG_PATTERN = /<!--[\s\S]*?(?:-->|$)|<\/?[a-z][^>]*>/gi;
/** Elements whose content is code, not text: dropped with their content. */
const DROPPED_ELEMENTS_PATTERN =
  /<(script|style|template|noscript|iframe|object|textarea|title)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
/** An `&` that already starts a character reference, kept as it is. */
const BARE_AMPERSAND_PATTERN = /&(?!#\d+;|#x[\da-f]+;|[a-z][a-z\d]*;)/gi;
const HREF_PATTERN = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;

const escapeHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * Text between tags, made safe without changing what it reads: a bare `&`,
 * `<` and `>` are escaped, a character reference already there is kept.
 * A line break becomes `<br>`, except in the blank between two tags.
 */
const escapeText = (value: string): string => {
  const escaped = value
    .replace(BARE_AMPERSAND_PATTERN, "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return escaped.trim() === "" ? escaped : escaped.replaceAll(/\r?\n/g, "<br>");
};

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
  if (tag.startsWith("<!--")) return "";
  const tagMatch = tag.match(TAG_NAME_PATTERN);

  if (!tagMatch) {
    return escapeText(tag);
  }

  const isClosingTag = tagMatch[1] === "/";
  const tagName = tagMatch[2]?.toLowerCase();

  if (!tagName) {
    return escapeText(tag);
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
 * `<span style>` or `<code>` never shows up as literal angle brackets.
 * Script-like elements go with their content, comments go. Text that is not
 * a tag is escaped once (see `escapeText`); plain-text line breaks become
 * `<br>`.
 */
export const sanitizeRichTextHtml = (html: string): string => {
  const source = html.replace(DROPPED_ELEMENTS_PATTERN, "");
  let sanitizedHtml = "";
  let lastIndex = 0;

  for (const match of source.matchAll(HTML_TAG_PATTERN)) {
    const matchIndex = match.index;

    sanitizedHtml += escapeText(source.slice(lastIndex, matchIndex));
    sanitizedHtml += sanitizeTag(match[0]);
    lastIndex = matchIndex + match[0].length;
  }

  sanitizedHtml += escapeText(source.slice(lastIndex));

  return sanitizedHtml;
};
