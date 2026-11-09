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

/** Milliseconds one call takes, the best of three (a busy machine adds noise). */
const timed = (html: string) =>
  Math.min(
    ...[0, 1, 2].map(() => {
      const start = performance.now();
      sanitize(html);
      return performance.now() - start;
    }),
  );

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
 * Inputs at the write limit (100,000 characters) built to make a naive
 * parser or pre-pass slow. A linear pass takes a few milliseconds each; the
 * bound is wide, so a CI runner busy with every other package's tests does
 * not fail it (one took 237 ms for the best of three), and a quadratic path
 * (seconds at this size) still does. The ratio test below is the finer check.
 */
const HOSTILE_INPUTS: ReadonlyArray<[string, string]> = [
  ['"<script " × 12,500', "<script ".repeat(12_500)],
  ['"<" + a × 99,999', `<${"a".repeat(99_999)}`],
  ['"<a " × 33,000', "<a ".repeat(33_000)],
  ['"<!--" × 25,000', "<!--".repeat(25_000)],
  ['"&" × 100,000', "&".repeat(100_000)],
  ['"<b>" × 33,000', "<b>".repeat(33_000)],
  ['"<em/>" × 20,000', "<em/>".repeat(20_000)],
  ['"<em></bogus>" × 8,000', "<em></bogus>".repeat(8_000)],
  ['"<em>" × 25,000', "<em>".repeat(25_000)],
  ['"<div>" × 20,000', "<div>".repeat(20_000)],
  ['"<p><strong><em>" × 6,600', "<p><strong><em>".repeat(6_600)],
  ['"<ul><li>" × 12,500', "<ul><li>".repeat(12_500)],
  ['"<a title=\\"" × 9,000', '<a title="'.repeat(9_000)],
  ['"<em title=\\"<b>\\">" × 6,000', '<em title="<b>">'.repeat(6_000)],
  ["a 64 KB description", `<p>${"Planche de surf à la journée. ".repeat(2_200)}</p>`],
];

test("hostile inputs at the write limit are sanitised in linear time", () => {
  sanitize("<p>warm up</p>");
  for (const [name, html] of HOSTILE_INPUTS) {
    const ms = timed(html);
    assert.ok(ms < 1_000, `${name} took ${ms.toFixed(1)} ms`);
  }
});

/** The median of an odd count of measures. */
const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1] ?? 0;

/**
 * How much more a four times larger input costs: medians of seven runs,
 * the two sizes taken in turn so a busy machine slows both alike.
 */
function growth(unit: string): { small: number; large: number } {
  const smallHtml = unit.repeat(10_000);
  const largeHtml = unit.repeat(40_000);
  const small: number[] = [];
  const large: number[] = [];
  for (let run = 0; run < 7; run += 1) {
    for (const [html, into] of [
      [smallHtml, small],
      [largeHtml, large],
    ] as const) {
      const start = performance.now();
      sanitize(html);
      into.push(performance.now() - start);
    }
  }
  return { small: median(small), large: median(large) };
}

test("four times the input costs about four times as much, never sixteen", () => {
  sanitize("<p>warm up</p>");
  for (const unit of ["<a>", "<em>x</em>", "<a ", "<script ", "<b>", "<em/>", "<em></bogus>"]) {
    // Linear grows about 4×, quadratic about 16×: under 10× passes. A
    // measure spoiled by load is taken again; a quadratic one fails each time.
    let last = { small: 0, large: 0 };
    const passes = [0, 1, 2].some(() => {
      last = growth(unit);
      // The floor absorbs timer noise on runs of a fraction of a millisecond.
      return last.large < Math.max(last.small, 1) * 10;
    });
    assert.ok(passes, `${unit}: ${last.small.toFixed(2)} ms, then ${last.large.toFixed(2)} ms`);
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

test("the depth check stops at the limit: deep inputs at the write limit cost almost nothing", () => {
  richTextTooDeep("<p>warm up</p>");
  for (const unit of ["<b>", "<em>", "<em/>", "<em></bogus>", "<svg><g>", "<ul><li>"]) {
    const html = unit.repeat(Math.floor(100_000 / unit.length));
    const start = performance.now();
    assert.equal(richTextTooDeep(html), true, unit);
    const ms = performance.now() - start;
    assert.ok(ms < 50, `${unit}: ${ms.toFixed(1)} ms`);
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
    const html = unit.repeat(Math.floor(100_000 / unit.length));
    const start = performance.now();
    sanitize(html);
    const ms = performance.now() - start;
    assert.ok(ms < 200, `${unit}: ${ms.toFixed(1)} ms`);
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
