import sanitizeHtml from "sanitize-html";

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

/**
 * Deepest unclosed tag the parser is given. The editor nests a few levels at
 * most (a list in a quote); htmlparser2 keeps open tags in an array it
 * unshifts, so each open tag costs as much as the depth below it, and a pile
 * of unclosed tags would cost the square of its length.
 */
const MAX_OPEN_DEPTH = 256;

/** Tags that never stay open, or that close an open one of their kind: no depth. */
const FLAT_TAGS = new Set([
  "br",
  "hr",
  "img",
  "input",
  "meta",
  "link",
  "area",
  "base",
  "col",
  "embed",
  "source",
  "track",
  "wbr",
  "p",
  "li",
  "dt",
  "dd",
  "option",
  "tr",
  "td",
  "th",
]);

// `[^<>]*` stops at the next `<`: one pass, whatever the input (a lazy `.*?>`
// would scan to the end from every unclosed `<`).
const TAG_EDGE_PATTERN = /<(\/?)([a-z][a-z\d]*)([^<>]*)>/gi;

/**
 * Escapes, in one pass, every opening tag that would sit deeper than
 * `MAX_OPEN_DEPTH` (it then reads as text, which the sanitiser escapes
 * again as it should). The depth is counted from the tags as written, an
 * upper bound of what the parser sees; editor HTML never comes near it.
 */
function boundNesting(html: string): string {
  let depth = 0;
  let out = "";
  let last = 0;
  for (const match of html.matchAll(TAG_EDGE_PATTERN)) {
    const [tag, closing, rawName, rest] = match;
    const selfClosing = (rest ?? "").trimEnd().endsWith("/");
    const name = (rawName ?? "").toLowerCase();
    if (closing) {
      if (!FLAT_TAGS.has(name)) depth = Math.max(0, depth - 1);
      continue;
    }
    if (selfClosing || FLAT_TAGS.has(name)) continue;
    depth += 1;
    if (depth > MAX_OPEN_DEPTH) {
      out += `${html.slice(last, match.index)}&lt;${tag.slice(1)}`;
      last = match.index + tag.length;
      depth -= 1;
    }
  }
  return last === 0 ? html : out + html.slice(last);
}

/** Longest HTML read: past it, the rest is cut before parsing. Write paths cap lower. */
export const MAX_RICH_TEXT_LENGTH = 200_000;

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

/** Only an absolute http(s) link, read as the browser would; anything else is no link. */
const safeHref = (href: string | undefined): string | null => {
  if (!href) return null;
  // Control characters and blanks a browser ignores inside a scheme.
  const decoded = [...decodeAttribute(href)]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code > 0x20 && (code < 0x7f || code > 0x9f);
    })
    .join("");
  return /^https?:\/\//i.test(decoded) ? decodeAttribute(href).trim() : null;
};

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: { a: ["href", "rel"] },
  allowedSchemes: ["http", "https"],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  nonTextTags: DROPPED_WITH_CONTENT,
  // Entities stay as written; only a bare `&`, `<` and `>` are escaped.
  parser: { decodeEntities: false },
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
 * breaks become `<br />`.
 */
export const sanitizeRichTextHtml = (html: string): string =>
  sanitizeHtml(
    boundNesting(html.length > MAX_RICH_TEXT_LENGTH ? html.slice(0, MAX_RICH_TEXT_LENGTH) : html),
    OPTIONS,
  );
