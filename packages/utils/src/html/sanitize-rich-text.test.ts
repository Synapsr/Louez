import assert from "node:assert/strict";
import { test } from "node:test";

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";

import { Parser } from "htmlparser2";

import { hasRichTextContent } from "./rich-text-content";
import {
  RICH_TEXT_MAX_DEPTH,
  richTextTooDeep,
  sanitizeRichText,
  sanitizeRichTextHtml as sanitize,
} from "./sanitize-rich-text";

/** Sanitised once, then saved again and rendered again: the same each time. */
const stable = (html: string) => {
  const once = sanitize(html);
  assert.equal(sanitize(once), once, `not idempotent for ${JSON.stringify(html)}`);
  assert.equal(sanitize(sanitize(once)), once);
  return once;
};

/** The deepest nesting of HTML as htmlparser2, the sanitiser's parser, reads it. */
const depthOf = (html: string) => {
  let depth = 0;
  let deepest = 0;
  const parser = new Parser(
    {
      onopentag: () => {
        depth += 1;
        deepest = Math.max(deepest, depth);
      },
      onclosetag: () => {
        depth -= 1;
      },
    },
    { decodeEntities: false },
  );
  parser.write(html);
  parser.end();
  return deepest;
};

/** The length of the longest value a write takes. */
const WRITE_LIMIT = 100_000;

/**
 * The characters the HTML parser reads while `work` runs: htmlparser2's
 * tokenizer reads its input one `charCodeAt` at a time, so this counts the
 * parser's steps, the same on any machine however busy.
 */
function parserReads(work: () => void): number {
  const charCodeAt = String.prototype.charCodeAt;
  let reads = 0;
  String.prototype.charCodeAt = function (this: string, index: number) {
    reads += 1;
    return charCodeAt.call(this, index);
  };
  try {
    work();
  } finally {
    String.prototype.charCodeAt = charCodeAt;
  }
  return reads;
}

/**
 * The CPU time this process spends on `work`, in microseconds: the time the
 * machine gives to other processes is not counted, so a busy runner does not
 * add to it.
 */
function cpuTime(work: () => void): number {
  const start = process.cpuUsage();
  work();
  const used = process.cpuUsage(start);
  return used.user + used.system;
}

/** How much larger the large input is than the small one. */
const SCALE = 16;

/**
 * What one input at the write limit costs against `SCALE` inputs of a
 * `SCALE`th of it: the same text either way, so a linear pass costs about
 * the same (a ratio about 1) and a quadratic one `SCALE` times as much. No
 * duration is compared with a fixed bound, only two costs measured side by
 * side. Each is the cheapest of five runs, taken in turn: load only ever
 * adds to a run.
 */
function costRatio(build: (length: number) => string, work: (html: string) => unknown): number {
  const small = build(WRITE_LIMIT / SCALE);
  const large = build(WRITE_LIMIT);
  let smalls = Number.POSITIVE_INFINITY;
  let larges = Number.POSITIVE_INFINITY;
  for (let run = 0; run < 5; run += 1) {
    smalls = Math.min(
      smalls,
      cpuTime(() => {
        for (let copy = 0; copy < SCALE; copy += 1) work(small);
      }),
    );
    larges = Math.min(
      larges,
      cpuTime(() => work(large)),
    );
  }
  return larges / Math.max(smalls, 1);
}

/**
 * Whether `work` costs about as much per character at the write limit as
 * at a `SCALE`th of it: under 4 passes, where linear is about 1 and
 * quadratic about 16. A ratio spoiled by load is measured again; a
 * quadratic one fails each time.
 */
function linear(build: (length: number) => string, work: (html: string) => unknown) {
  let ratio = 0;
  const passes = [0, 1, 2].some(() => {
    ratio = costRatio(build, work);
    return ratio < 4;
  });
  return { passes, ratio: ratio.toFixed(2) };
}

/** An input of `unit` repeated, as long as `length` allows. */
const repeated = (unit: string) => (length: number) =>
  unit.repeat(Math.floor(length / unit.length));

test("plain text is escaped once, with its line breaks", () => {
  assert.equal(stable("Fish & chips < 10 € > 5"), "Fish &amp; chips &lt; 10 € &gt; 5");
  assert.equal(stable("a\nb"), "a<br />b");
});

test("character references already there are kept, not escaped again", () => {
  assert.equal(stable("<p>Tom &amp; Jerry</p>"), "<p>Tom &amp; Jerry</p>");
  assert.equal(
    stable("<p>x&nbsp;y &eacute; &#233; &#xE9;</p>"),
    "<p>x&nbsp;y &eacute; &#233; &#xE9;</p>",
  );
  assert.equal(stable("<p>&lt;script&gt;</p>"), "<p>&lt;script&gt;</p>");
});

test("editor HTML round-trips as it is", () => {
  const editor =
    "<h2>Conditions</h2><p>Le <strong>matériel</strong> est <em>rendu</em> <u>propre</u>, <s>sale</s>.</p><ul><li>Un</li><li>Deux</li></ul><ol><li>Trois</li></ol><blockquote><p>Cité</p></blockquote><hr /><p>Ligne<br />suivante</p>";
  assert.equal(stable(editor), editor);
  assert.equal(
    stable('<p><a href="https://louez.io/?a=1&amp;b=2">lien</a></p>'),
    '<p><a href="https://louez.io/?a=1&amp;b=2" rel="noopener noreferrer">lien</a></p>',
  );
});

test("a blank line between two tags adds no break", () => {
  assert.equal(stable("<p>One</p>\n<p>Two</p>"), "<p>One</p>\n<p>Two</p>");
});

test("a comment goes whole, even one that holds a tag", () => {
  assert.equal(stable("<p>Terms <!-- <script> --> still apply.</p>"), "<p>Terms  still apply.</p>");
  assert.equal(stable("<p>a<!-- note -->b</p>"), "<p>ab</p>");
});

test("only http and https links keep their href, however they are written", () => {
  for (const href of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java&#115;cript:alert(1)",
    "java&#x73;cript:alert(1)",
    "jav\tascript:alert(1)",
    " javascript:alert(1)",
    "javascript&colon;alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "//evil.test/x",
    "/relative",
  ]) {
    assert.equal(stable(`<a href="${href}">x</a>`), "<a>x</a>", href);
  }
  assert.equal(
    stable('<a href="https://ok.test" target="_blank" onclick="x()">x</a>'),
    '<a href="https://ok.test" rel="noopener noreferrer">x</a>',
  );
});

test("event handlers and other attributes go; unknown tags keep their text", () => {
  assert.equal(stable('<p onclick="x()" style="color:red" class="c">Hi</p>'), "<p>Hi</p>");
  assert.equal(stable('<img src="x" onerror="alert(1)"><p>After</p>'), "<p>After</p>");
  assert.equal(stable('<p><span style="color:red">Red</span> <code>x</code></p>'), "<p>Red x</p>");
});

test("scripts go with their content, inside svg or math too", () => {
  assert.equal(stable("<p>Hi</p><script>alert(1)</script><style>p{}</style>"), "<p>Hi</p>");
  assert.equal(stable("<svg><script>alert(1)</script><p>In</p></svg>"), "<p>In</p>");
  assert.equal(
    stable('<svg><foreignObject><img src=x onerror="alert(1)"></foreignObject></svg>t'),
    "t",
  );
  assert.equal(stable("<math><mtext><script>alert(1)</script></mtext></math>m"), "m");
  assert.equal(stable("<noscript><p>x</p></noscript>y"), "y");
});

test("text that only looks like a tag stays text", () => {
  assert.equal(stable("<p>a < b</p>"), "<p>a &lt; b</p>");
  assert.equal(stable("<p>1 <2</p>"), "<p>1 &lt;2</p>");
});

test("an editor left empty shows nothing", () => {
  for (const html of ["", "<p></p>", "<p>&nbsp;</p>", "<p> </p>", "<h2> </h2><br />"]) {
    assert.equal(hasRichTextContent(html), false, html);
  }
  assert.equal(hasRichTextContent("<p>x</p>"), true);
  assert.equal(hasRichTextContent(null), false);
});

/**
 * Inputs built to make a naive parser or pre-pass slow, of any length: each
 * test builds them at the write limit and at a sixteenth of it.
 */
const HOSTILE_INPUTS: ReadonlyArray<[string, (length: number) => string]> = [
  ['"<script " repeated', repeated("<script ")],
  ['"<" then "a" to the end', (length) => `<${"a".repeat(length - 1)}`],
  ['"<a " repeated', repeated("<a ")],
  ['"<a>" repeated', repeated("<a>")],
  ['"<!--" repeated', repeated("<!--")],
  ['"&" repeated', repeated("&")],
  ['"<b>" repeated', repeated("<b>")],
  ['"<em/>" repeated', repeated("<em/>")],
  ['"<em></bogus>" repeated', repeated("<em></bogus>")],
  ['"<em>x</em>" repeated', repeated("<em>x</em>")],
  ['"<em>" repeated', repeated("<em>")],
  ['"<div>" repeated', repeated("<div>")],
  ['"<p><strong><em>" repeated', repeated("<p><strong><em>")],
  ['"<ul><li>" repeated', repeated("<ul><li>")],
  ['"<a title=\\"" repeated', repeated('<a title="')],
  ['"<em title=\\"<b>\\">" repeated', repeated('<em title="<b>">')],
  [
    "a long description",
    (length) => `<p>${repeated("Planche de surf à la journée. ")(length)}</p>`,
  ],
];

test("hostile inputs cost as much per character at the write limit as at a sixteenth of it", () => {
  sanitize("<p>warm up</p>");
  for (const [name, build] of HOSTILE_INPUTS) {
    const { passes, ratio } = linear(build, sanitize);
    assert.ok(passes, `${name}: the input at the write limit costs ${ratio} times as much`);
  }
});

test("a long input is sanitised whole, and the result is stable", () => {
  const out = stable(`<p>${"&".repeat(70_000)}</p><p>tail</p>`);
  assert.ok(out.endsWith("<p>tail</p>"));
  assert.ok(out.length > 300_000);
});

test("a link keeps its entities as written, pass after pass", () => {
  assert.equal(
    stable('<a href="https://x.test/?q=&amp;amp;amp;">x</a>'),
    '<a href="https://x.test/?q=&amp;amp;amp;" rel="noopener noreferrer">x</a>',
  );
  assert.equal(
    stable('<a href="https://x.test/?a=1&b=2&amp;c=3">x</a>'),
    '<a href="https://x.test/?a=1&amp;b=2&amp;c=3" rel="noopener noreferrer">x</a>',
  );
  assert.equal(
    stable("<a href='https://x.test/?t=\"q\"'>x</a>"),
    '<a href="https://x.test/?t=&quot;q&quot;" rel="noopener noreferrer">x</a>',
  );
});

/**
 * Inputs that nest deep where a hand-written tokenizer and htmlparser2 would
 * disagree (comments, CDATA, odd attributes, foreign content, raw text, odd
 * names): the depth is the parser's own, so none gets past the limit, and a
 * second pass changes nothing.
 */
const DEEP_INPUTS: ReadonlyArray<[string, string]> = [
  ["<em> × 300", "<em>".repeat(300)],
  ["<em/> × 300", "<em/>".repeat(300)],
  ["<em></bogus> × 300", "<em></bogus>".repeat(300)],
  ["<em><script></em></script> × 300", "<em><script></em></script>".repeat(300)],
  ["<!--> then <em> × 300", `<!-->${"<em>".repeat(300)}x`],
  ["<em><![CDATA[></em>]]> × 300", "<em><![CDATA[></em>]]>".repeat(300)],
  ['<em x=y=" > × 300', '<em x=y=" >'.repeat(300)],
  ["<svg><title></svg> then <em> × 300", `<svg><title></svg>${"<em>".repeat(300)}`],
  [
    "<em><textarea></textareax></em></textarea> × 300",
    "<em><textarea></textareax></em></textarea>".repeat(300),
  ],
  ["<em_x></em> × 300", "<em_x></em>".repeat(300)],
  [
    "<blockquote> × 300 around text",
    `${"<blockquote>".repeat(300)}x${"</blockquote>".repeat(300)}`,
  ],
];

test("deep inputs are caught as the parser reads them, and stay stable", () => {
  for (const [name, html] of DEEP_INPUTS) {
    assert.equal(richTextTooDeep(html), depthOf(html) > RICH_TEXT_MAX_DEPTH, name);
    const once = stable(html);
    assert.ok(depthOf(once) <= RICH_TEXT_MAX_DEPTH, `${name}: depth ${depthOf(once)}`);
  }
});

test("past the deepest nesting, only the text is kept, escaped", () => {
  const out = stable(
    `${"<blockquote>".repeat(300)}Tom & <b>Jerry</b>${"</blockquote>".repeat(300)}`,
  );
  assert.equal(out, "Tom &amp; Jerry");
});

test("shallow foreign markup keeps its text and what follows", () => {
  // Depth 2 for the parser, however many siblings.
  const html = `<svg>${"<g/>".repeat(300)}</svg><p>tail</p>`;
  assert.equal(richTextTooDeep(html), false);
  assert.equal(stable(html), "<p>tail</p>");
  assert.equal(stable(`<svg><image href="x"/>${"<image/>".repeat(300)}</svg><p>t</p>`), "<p>t</p>");
});

test("editor nesting is untouched", () => {
  const nested =
    "<blockquote><ul><li><p><strong><em><u><s>deep</s></u></em></strong></p></li></ul></blockquote>";
  assert.equal(stable(nested), nested);
  assert.equal(richTextTooDeep(nested), false);
});

test("the depth check stops at the limit: a deep input at the write limit is read only that far", () => {
  // The count sees the parser's work: a shallow input is read whole.
  const shallow = repeated("<p>x</p>")(WRITE_LIMIT);
  assert.ok(parserReads(() => richTextTooDeep(shallow)) >= shallow.length);
  for (const unit of ["<b>", "<em>", "<em/>", "<em></bogus>", "<svg><g>", "<ul><li>"]) {
    const html = repeated(unit)(WRITE_LIMIT);
    let tooDeep = false;
    const reads = parserReads(() => {
      tooDeep = richTextTooDeep(html);
    });
    assert.equal(tooDeep, true, unit);
    // Reaching the limit takes at most a unit per level: well under twice that, never the input.
    const toTheLimit = (RICH_TEXT_MAX_DEPTH + 1) * unit.length;
    assert.ok(reads < 2 * toTheLimit, `${unit}: ${reads} characters read of ${html.length}`);
  }
});

test("a line break the sanitiser adds counts in the depth", () => {
  const html = `${"<blockquote>".repeat(256)}a\nb${"</blockquote>".repeat(256)}`;
  // As sent, 256 levels; once its line break is a `<br />`, 257.
  assert.equal(richTextTooDeep(html), false);
  const { html: out, tooDeep } = sanitizeRichText(html);
  assert.equal(tooDeep, true);
  assert.equal(out, "a<br />b");
  assert.equal(stable(html), "a<br />b");
  assert.ok(depthOf(out) <= RICH_TEXT_MAX_DEPTH);
});

test("too deep, a value shows its visible text only, as the sanitiser would", () => {
  const deep = (inner: string) =>
    `${"<blockquote>".repeat(300)}${inner}${"</blockquote>".repeat(300)}`;
  // No attribute value, no script or style text, no comment.
  assert.equal(stable(deep('<a title="PRIVATE>ATTRIBUTE">public</a>')), "public");
  assert.equal(
    stable(deep("<script>SECRET()</script><style>.s{}</style><!-- HIDDEN -->visible")),
    "visible",
  );
  assert.equal(stable(deep("<textarea>typed</textarea><noscript>no</noscript>shown")), "shown");
  // Canonical: line breaks and entities read as the sanitiser writes them.
  assert.equal(stable(deep("a\nb")), "a<br />b");
  assert.equal(stable(deep("Tom &amp; Jerry & co")), "Tom &amp; Jerry &amp; co");
  assert.equal(stable(deep("1 < 2 > 0")), "1 &lt; 2 &gt; 0");
});

test("the deep fallback reads text in one pass, however deep", () => {
  sanitize("<p>warm up</p>");
  for (const unit of ["<b>", "<em></bogus>", "<svg><g>", "<em><script>x</script>"]) {
    const build = repeated(unit);
    const html = build(WRITE_LIMIT);
    assert.equal(richTextTooDeep(html), true, unit);
    // One pass over the input, and the depth check that stops at the limit.
    const reads = parserReads(() => sanitize(html));
    assert.ok(reads < 2 * html.length, `${unit}: ${reads} characters read of ${html.length}`);
    // And no step of it grows with the depth.
    const { passes, ratio } = linear(build, sanitize);
    assert.ok(passes, `${unit}: the input at the write limit costs ${ratio} times as much`);
  }
});

test("the depth check parses with the very htmlparser2 sanitize-html uses", () => {
  const require = createRequire(import.meta.url);
  const own = realpathSync(require.resolve("htmlparser2"));
  const fromSanitizeHtml = realpathSync(
    createRequire(require.resolve("sanitize-html")).resolve("htmlparser2"),
  );
  // One module: a bump of either dependency that makes them differ fails here.
  assert.equal(own, fromSanitizeHtml);
});
