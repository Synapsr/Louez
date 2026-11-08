import assert from "node:assert/strict";
import { test } from "node:test";

import { hasRichTextContent } from "./rich-text-content";
import { sanitizeRichTextHtml as sanitize } from "./sanitize-rich-text";

/** Sanitised once, then saved again and rendered again: the same each time. */
const stable = (html: string) => {
  const once = sanitize(html);
  assert.equal(sanitize(once), once, `not idempotent for ${JSON.stringify(html)}`);
  assert.equal(sanitize(sanitize(once)), once);
  return once;
};

/** The deepest nesting of sanitised HTML, which only holds the editor's tags. */
const depthOf = (html: string) => {
  let depth = 0;
  let deepest = 0;
  for (const [, closing, name] of html.matchAll(/<(\/?)([a-z][a-z\d]*)/g)) {
    if (name === "br" || name === "hr") continue;
    depth += closing ? -1 : 1;
    deepest = Math.max(deepest, depth);
  }
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

test("tags past the deepest nesting read as text; editor nesting is untouched", () => {
  const deep = `${"<blockquote>".repeat(300)}x${"</blockquote>".repeat(300)}`;
  const out = stable(deep);
  assert.equal(depthOf(out), 256);
  assert.ok(out.includes("&lt;blockquote&gt;"));
  const nested =
    "<blockquote><ul><li><p><strong><em><u><s>deep</s></u></em></strong></p></li></ul></blockquote>";
  assert.equal(stable(nested), nested);
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
 * bound is wide, so a machine busy with other tests does not fail it, and a
 * quadratic path (seconds at this size) still does.
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
    assert.ok(ms < 200, `${name} took ${ms.toFixed(1)} ms`);
  }
});

test("four times the input costs about four times as much, never sixteen", () => {
  sanitize("<p>warm up</p>");
  for (const unit of ["<b>", "<em/>", "<em></bogus>", "<script ", "<a ", "<em>"]) {
    const small = timed(unit.repeat(10_000));
    const large = timed(unit.repeat(40_000));
    // The floor absorbs timer noise on tiny runs.
    assert.ok(
      large < Math.max(small, 2) * 10,
      `${unit}: ${small.toFixed(1)} ms, then ${large.toFixed(1)} ms`,
    );
  }
});

test("a self-closing or stray tag does not hide depth from the count", () => {
  // The parser opens `<em/>` (it ignores the slash in HTML) and `</bogus>` closes nothing.
  assert.equal(depthOf(stable("<em/>".repeat(300))), 256);
  assert.equal(depthOf(stable("<em></bogus>".repeat(300))), 256);
  // A matched close frees its level: closed pairs never pile up, and none is lost.
  const pairs = stable("<em>x</em>".repeat(1_000));
  assert.equal(depthOf(pairs), 1);
  assert.equal(pairs.match(/<em>/g)?.length, 1_000);
  // Implied closes free theirs too, as for the parser.
  const paragraphs = stable("<p>x".repeat(1_000));
  assert.equal(paragraphs.match(/<p>/g)?.length, 1_000);
});

test("a close inside a raw-text element frees no level", () => {
  // `</em>` inside a script is text for the parser, which keeps the `em` open.
  assert.ok(depthOf(stable("<em><script></em></script>".repeat(300))) <= 256);
  assert.ok(depthOf(stable("<em><textarea></em></textarea>".repeat(300))) <= 256);
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
