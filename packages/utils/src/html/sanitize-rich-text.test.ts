import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeRichTextHtml as sanitize } from "./sanitize-rich-text";

/** Sanitised once, then saved again and rendered again: the same each time. */
const stable = (html: string) => {
  const once = sanitize(html);
  assert.equal(sanitize(once), once, `not idempotent for ${JSON.stringify(html)}`);
  assert.equal(sanitize(sanitize(once)), once);
  return once;
};

test("plain text is escaped once, with its line breaks", () => {
  assert.equal(stable("Fish & chips < 10 € > 5"), "Fish &amp; chips &lt; 10 € &gt; 5");
  assert.equal(stable("a\nb"), "a<br>b");
});

test("character references already there are kept, not escaped again", () => {
  assert.equal(stable("<p>Tom &amp; Jerry</p>"), "<p>Tom &amp; Jerry</p>");
  assert.equal(
    stable("<p>x&nbsp;y &eacute; &#233; &#xE9;</p>"),
    "<p>x&nbsp;y &eacute; &#233; &#xE9;</p>",
  );
  assert.equal(stable("<p>&lt;script&gt;</p>"), "<p>&lt;script&gt;</p>");
});

test("editor HTML is kept as it is", () => {
  const editor =
    '<h2>Conditions</h2><p>Le <strong>matériel</strong> est <em>rendu</em> propre.</p><ul><li>Un</li><li>Deux</li></ul><p><a href="https://louez.io/?a=1&amp;b=2">lien</a></p>';
  assert.equal(
    stable(editor),
    '<h2>Conditions</h2><p>Le <strong>matériel</strong> est <em>rendu</em> propre.</p><ul><li>Un</li><li>Deux</li></ul><p><a href="https://louez.io/?a=1&amp;b=2" rel="noopener noreferrer">lien</a></p>',
  );
});

test("a blank line between two tags adds no break", () => {
  assert.equal(stable("<p>One</p>\n<p>Two</p>"), "<p>One</p>\n<p>Two</p>");
});

test("script-like elements go with their content, comments go, unknown tags keep their text", () => {
  assert.equal(stable("<p>Hi</p><script>alert(1)</script><style>p{}</style>"), "<p>Hi</p>");
  assert.equal(stable("<p>a<!-- note -->b</p>"), "<p>ab</p>");
  assert.equal(stable('<p onclick="x()"><span style="color:red">Red</span></p>'), "<p>Red</p>");
  assert.equal(stable('<a href="javascript:alert(1)">x</a>'), "<a>x</a>");
});

test("text that only looks like a tag stays text", () => {
  assert.equal(stable("<p>a < b</p>"), "<p>a &lt; b</p>");
  assert.equal(stable("<p>1 <2</p>"), "<p>1 &lt;2</p>");
});
