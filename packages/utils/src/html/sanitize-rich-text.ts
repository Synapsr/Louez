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

// What htmlparser2 does with tags (its Parser and Tokenizer), mirrored so the
// depth counted here is the depth it builds.

/** Never pushed on the stack. */
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "basefont",
  "br",
  "col",
  "command",
  "embed",
  "frame",
  "hr",
  "img",
  "input",
  "isindex",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** Their content is text up to their own closing tag. */
const RAW_TEXT_ELEMENTS = new Set([
  "script",
  "style",
  "title",
  "textarea",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
]);

const P = ["p"];
const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6", "p"];
const FORM = ["input", "option", "optgroup", "select", "button", "datalist", "textarea"];
const CLOSE_P = [
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "header",
  "hr",
  "main",
  "nav",
  "ol",
  "pre",
  "section",
  "table",
  "ul",
];

/** Opening the key first closes open elements of these names, from the top. */
const OPEN_IMPLIES_CLOSE = new Map<string, ReadonlySet<string>>(
  Object.entries<string[]>({
    tr: ["tr", "th", "td"],
    th: ["th"],
    td: ["thead", "th", "td"],
    body: ["head", "link", "script"],
    a: ["a"],
    li: ["li"],
    p: P,
    h1: HEADINGS,
    h2: HEADINGS,
    h3: HEADINGS,
    h4: HEADINGS,
    h5: HEADINGS,
    h6: HEADINGS,
    select: FORM,
    input: FORM,
    output: FORM,
    button: FORM,
    datalist: FORM,
    textarea: FORM,
    option: ["option"],
    optgroup: ["optgroup", "option"],
    dd: ["dd", "dt"],
    dt: ["dd", "dt"],
    rt: ["rt", "rp"],
    rp: ["rt", "rp"],
    tbody: ["thead", "tbody"],
    tfoot: ["thead", "tbody"],
    ...Object.fromEntries(CLOSE_P.map((name) => [name, P])),
  }).map(([name, closes]) => [name, new Set(closes)]),
);

const isAsciiLetter = (code: number) => (code | 0x20) >= 0x61 && (code | 0x20) <= 0x7a;
const isNameChar = (code: number) =>
  isAsciiLetter(code) || (code >= 0x30 && code <= 0x39) || code === 0x2d || code === 0x3a;
const isBlank = (char: string) =>
  char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";

/**
 * Index of the `>` that ends a tag whose name ends at `from`, or -1 when the
 * tag never ends. A quote opens a value only after `=`, as for the parser.
 */
function tagEnd(html: string, from: number): number {
  let afterEquals = false;
  for (let index = from; index < html.length; index += 1) {
    const char = html[index] ?? "";
    if (char === ">") return index;
    if ((char === '"' || char === "'") && afterEquals) {
      const close = html.indexOf(char, index + 1);
      if (close === -1) return -1;
      index = close;
      afterEquals = false;
    } else if (char === "=") {
      afterEquals = true;
    } else if (!isBlank(char)) {
      afterEquals = false;
    }
  }
  return -1;
}

/**
 * One pass over the HTML, an index loop that never steps back: it follows
 * the parser's stack (void tags, raw text, implied and matched closes) and
 * turns every opening tag that would sit deeper than `MAX_OPEN_DEPTH` into
 * text. Editor HTML never comes near that depth.
 */
function boundNesting(html: string): string {
  const lower = html.toLowerCase();
  const stack: string[] = [];
  const openCount = new Map<string, number>();
  const parts: string[] = [];
  let last = 0;

  const push = (name: string) => {
    stack.push(name);
    openCount.set(name, (openCount.get(name) ?? 0) + 1);
  };
  const pop = () => {
    const name = stack.pop();
    if (name !== undefined) openCount.set(name, (openCount.get(name) ?? 1) - 1);
  };

  let index = html.indexOf("<");
  while (index !== -1) {
    const next = html.charCodeAt(index + 1);
    // A comment, a doctype or a processing instruction: no tag.
    if (next === 0x21 || next === 0x3f) {
      const isComment = lower.startsWith("!--", index + 1);
      const end = isComment ? html.indexOf("-->", index + 4) : html.indexOf(">", index + 2);
      if (end === -1) break;
      index = html.indexOf("<", end + (isComment ? 3 : 1));
      continue;
    }
    const closing = next === 0x2f;
    const nameStart = index + (closing ? 2 : 1);
    if (!isAsciiLetter(html.charCodeAt(nameStart))) {
      index = html.indexOf("<", index + 1);
      continue;
    }
    let nameEnd = nameStart + 1;
    while (nameEnd < html.length && isNameChar(html.charCodeAt(nameEnd))) nameEnd += 1;
    const name = lower.slice(nameStart, nameEnd);
    const end = tagEnd(html, nameEnd);
    // An unfinished tag: the rest is no tag for the parser either.
    if (end === -1) break;

    if (closing) {
      // A close without its open (`</bogus>`) closes nothing, as for the parser.
      if (!VOID_ELEMENTS.has(name) && (openCount.get(name) ?? 0) > 0) {
        while (stack.length > 0 && stack[stack.length - 1] !== name) pop();
        pop();
      }
      index = html.indexOf("<", end + 1);
      continue;
    }

    if (name === "plaintext") break;
    const closes = OPEN_IMPLIES_CLOSE.get(name);
    if (closes) {
      while (stack.length > 0 && closes.has(stack[stack.length - 1] ?? "")) pop();
    }
    // `<em/>` opens `em`: the parser ignores the slash outside SVG and MathML.
    const opens =
      !VOID_ELEMENTS.has(name) && !(name === "form" && (openCount.get("form") ?? 0) > 0);
    if (opens && stack.length >= MAX_OPEN_DEPTH) {
      // The whole tag reads as text, attributes included.
      parts.push(html.slice(last, index), html.slice(index, end + 1).replaceAll("<", "&lt;"));
      last = end + 1;
      index = html.indexOf("<", end + 1);
      continue;
    }
    if (opens) push(name);
    if (RAW_TEXT_ELEMENTS.has(name)) {
      const closeAt = lower.indexOf(`</${name}`, end + 1);
      if (closeAt === -1) break;
      index = closeAt;
      continue;
    }
    index = html.indexOf("<", end + 1);
  }
  return last === 0 ? html : parts.join("") + html.slice(last);
}

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
  sanitizeHtml(boundNesting(html), OPTIONS);
