import assert from "node:assert/strict";
import { test } from "node:test";

import { hasRichTextContent } from "./rich-text-content";
import { MAX_RICH_TEXT_LENGTH, sanitizeRichTextHtml as sanitize } from "./sanitize-rich-text";

/** Sanitised once, then saved again and rendered again: the same each time. */
const stable = (html: string) => {
  const once = sanitize(html);
  assert.equal(sanitize(once), once, `not idempotent for ${JSON.stringify(html)}`);
  assert.equal(sanitize(sanitize(once)), once);
  return once;
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

test("its cost grows with the input, not faster: 100,000 characters stay well under 50 ms", () => {
  const payloads = [
    "<script ".repeat(12_500),
    "<a ".repeat(33_000),
    "<!--".repeat(25_000),
    "&".repeat(100_000),
    `<p>${"x".repeat(64_000)}</p>`,
    "<p><strong><em>".repeat(6_600),
    "<b>".repeat(33_000),
    "<em>".repeat(25_000),
    "<div>".repeat(20_000),
    "<ul><li>".repeat(12_500),
  ];
  // The parser's first call loads its code: not counted.
  sanitize("<p>warm up</p>");
  for (const payload of payloads) {
    const ms = timed(payload);
    assert.ok(ms < 50, `${payload.slice(0, 12)}… took ${ms.toFixed(1)} ms`);
  }
});

test("tags past the deepest nesting read as text; editor nesting is untouched", () => {
  const deep = `${"<blockquote>".repeat(300)}x${"</blockquote>".repeat(300)}`;
  const out = stable(deep);
  assert.equal(out.match(/<blockquote>/g)?.length, 256);
  assert.ok(out.includes("&lt;blockquote&gt;"));
  const nested =
    "<blockquote><ul><li><p><strong><em><u><s>deep</s></u></em></strong></p></li></ul></blockquote>";
  assert.equal(stable(nested), nested);
});

test("an input past the cap is cut before it is parsed", () => {
  const long = `<p>${"y".repeat(MAX_RICH_TEXT_LENGTH)}</p><p>tail</p>`;
  const out = sanitize(long);
  assert.ok(!out.includes("tail"));
  assert.ok(out.length <= MAX_RICH_TEXT_LENGTH + 10);
});

test("an editor left empty shows nothing", () => {
  for (const html of ["", "<p></p>", "<p>&nbsp;</p>", "<p> </p>", "<h2> </h2><br />"]) {
    assert.equal(hasRichTextContent(html), false, html);
  }
  assert.equal(hasRichTextContent("<p>x</p>"), true);
  assert.equal(hasRichTextContent(null), false);
});
