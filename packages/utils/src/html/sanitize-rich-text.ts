import { Parser, type ParserOptions } from "htmlparser2";
import sanitizeHtml from "sanitize-html";

import { RICH_TEXT_MAX_DEPTH } from "./rich-text-content";

/**
 * Allow-list sanitiser for HTML written in the dashboard rich-text editor
 * (store description, product description, terms, legal notice). Runs on
 * write (API services) and on read (storefront, dashboard), always on the
 * server: it is not exported from the package's root, so no client bundle
 * carries the parser.
 *
 * It parses the HTML (htmlparser2, through sanitize-html), so its cost grows
 * with the input's length, whatever the input, and it is idempotent:
 * sanitising its own output changes nothing, so a value saved again and
 * again, then rendered, keeps its text as it was (`&amp;` stays one `&`).
 */

/** The editor's tags; any other tag is dropped and its text kept. */
const ALLOWED_TAGS = [
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
];

/** Elements whose content is code or not text: dropped with their content. */
const DROPPED_WITH_CONTENT = [
  "script",
  "style",
  "template",
  "noscript",
  "textarea",
  "option",
  "title",
  "iframe",
  "object",
];

export { RICH_TEXT_MAX_DEPTH };

/**
 * The parser's options, the same for the depth check and for sanitize-html:
 * entities stay as written; only a bare `&`, `<` and `>` are escaped.
 */
const PARSER_OPTIONS: ParserOptions = { decodeEntities: false };

const TOO_DEEP = Symbol("too deep");

/**
 * Whether the HTML nests deeper than `RICH_TEXT_MAX_DEPTH`, as htmlparser2
 * itself reads it (the parser sanitize-html uses, with its options). The
 * parse stops as soon as it gets there, so its stack never grows past the
 * limit: a deep input is caught in well under a millisecond, and any other
 * costs one linear parse.
 */
export function richTextTooDeep(html: string): boolean {
  let depth = 0;
  const parser = new Parser(
    {
      onopentag: () => {
        depth += 1;
        if (depth > RICH_TEXT_MAX_DEPTH) throw TOO_DEEP;
      },
      onclosetag: () => {
        depth -= 1;
      },
    },
    PARSER_OPTIONS,
  );
  try {
    parser.write(html);
    parser.end();
    return false;
  } catch (error) {
    if (error === TOO_DEEP) return true;
    throw error;
  }
}

/**
 * HTML no editor wrote: its text without any markup, escaped. One linear
 * pass (`[^<>]*` stops at the next `<`), and stable when sanitised again.
 */
const textOnly = (html: string): string =>
  html
    .replace(/<[^<>]*>/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"',
  colon: ":",
  tab: "\t",
  newline: "\n",
};

/** The href as a browser reads it: character references decoded. */
const decodeAttribute = (value: string): string =>
  value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));?/gi, (entity, decimal, hexadecimal, name) => {
    if (decimal || hexadecimal) {
      const codePoint = Number.parseInt(decimal ?? hexadecimal, decimal ? 10 : 16);
      return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : "�";
    }
    return NAMED_ENTITIES[String(name).toLowerCase()] ?? entity;
  });

/**
 * Only an absolute http(s) link, its scheme read on a decoded copy as the
 * browser would; anything else is no link.
 */
const safeHref = (href: string | undefined): string | null => {
  if (!href) return null;
  // Control characters and blanks a browser ignores inside a scheme.
  const decoded = [...decodeAttribute(href)]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code > 0x20 && (code < 0x7f || code > 0x9f);
    })
    .join("");
  // The value stays as written: decoding it here would drop one layer of
  // escaping on each pass (`&amp;amp;` → `&amp;`).
  return /^https?:\/\//i.test(decoded) ? href.trim() : null;
};

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: { a: ["href", "rel"] },
  allowedSchemes: ["http", "https"],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  nonTextTags: DROPPED_WITH_CONTENT,
  parser: PARSER_OPTIONS,
  transformTags: {
    a: (_tagName, attribs) => {
      const href = safeHref(attribs.href);
      const safe: sanitizeHtml.Attributes = href ? { href, rel: "noopener noreferrer" } : {};
      return { tagName: "a", attribs: safe };
    },
  },
  // Plain-text line breaks become `<br />`; the blank between two tags does not.
  textFilter: (text) => (text.trim() === "" ? text : text.replace(/\r?\n/g, "<br />")),
};

/**
 * Keeps the editor's markup (allow-list above, attributes stripped except a
 * safe `href`) and drops every other tag while keeping its text, so a pasted
 * `<span style>` or `<code>` never shows up as literal angle brackets.
 * Script-like elements go with their content, comments go. Plain-text line
 * breaks become `<br />`. HTML nested deeper than `RICH_TEXT_MAX_DEPTH`
 * (never the editor's) comes out as its text alone: writes refuse it first.
 */
export const sanitizeRichTextHtml = (html: string): string =>
  richTextTooDeep(html) ? textOnly(html) : sanitizeHtml(html, OPTIONS);
