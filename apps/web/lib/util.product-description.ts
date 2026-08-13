const ALLOWED_TAGS = new Set([
  'a',
  'blockquote',
  'br',
  'em',
  'h1',
  'h2',
  'h3',
  'hr',
  'li',
  'ol',
  'p',
  's',
  'strong',
  'ul',
]);

const VOID_TAGS = new Set(['br', 'hr']);
const HTML_TAG_PATTERN = /<[^>]*>/g;
const HREF_PATTERN = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const escapeHtmlAttribute = (value: string): string =>
  escapeHtml(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const decodeCodePoint = (value: string, radix: 10 | 16): string => {
  const codePoint = Number.parseInt(value, radix);

  if (!Number.isSafeInteger(codePoint) || codePoint > 0x10ffff) {
    return '\uFFFD';
  }

  return String.fromCodePoint(codePoint);
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

      const namedEntities: Record<string, string> = {
        '&amp;': '&',
        '&apos;': "'",
        '&gt;': '>',
        '&lt;': '<',
        '&quot;': '"',
      };

      return namedEntities[entity.toLowerCase()] ?? entity;
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

const sanitizeTag = (tag: string): string => {
  const tagMatch = tag.match(/^<\s*(\/?)\s*([a-z\d]+)(?:\s[^>]*)?\s*\/?\s*>$/i);

  if (!tagMatch) {
    return escapeHtml(tag);
  }

  const isClosingTag = tagMatch[1] === '/';
  const tagName = tagMatch[2]?.toLowerCase();

  if (!tagName || !ALLOWED_TAGS.has(tagName)) {
    return escapeHtml(tag);
  }

  if (VOID_TAGS.has(tagName)) {
    return isClosingTag ? '' : `<${tagName}>`;
  }

  if (isClosingTag) {
    return `</${tagName}>`;
  }

  if (tagName === 'a') {
    const href = getSafeHref(tag);
    return href ? `<a href="${href}" rel="noopener noreferrer">` : '<a>';
  }

  return `<${tagName}>`;
};

export const sanitizeProductDescriptionHtml = (html: string): string => {
  let sanitizedHtml = '';
  let lastIndex = 0;

  for (const match of html.matchAll(HTML_TAG_PATTERN)) {
    const matchIndex = match.index;

    sanitizedHtml += escapeHtml(html.slice(lastIndex, matchIndex)).replaceAll(
      /\r?\n/g,
      '<br>',
    );
    sanitizedHtml += sanitizeTag(match[0]);
    lastIndex = matchIndex + match[0].length;
  }

  sanitizedHtml += escapeHtml(html.slice(lastIndex)).replaceAll(
    /\r?\n/g,
    '<br>',
  );

  return sanitizedHtml;
};
