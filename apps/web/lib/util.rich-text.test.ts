import assert from "node:assert/strict";
import { test } from "node:test";

import { hasRichTextContent } from "@louez/utils";

import { sanitizeRichTextHtml } from "./util.rich-text";

test("sanitizeRichTextHtml keeps editor markup and drops script tags", () => {
  assert.equal(
    sanitizeRichTextHtml("<h2>Titre</h2><p>Texte <em>libre</em></p><script>alert(1)</script>"),
    // A script goes with its content.
    "<h2>Titre</h2><p>Texte <em>libre</em></p>",
  );
});

test("sanitizeRichTextHtml keeps underlined text from the editor", () => {
  assert.equal(
    sanitizeRichTextHtml("<p><u>Souligné</u> et <s>barré</s></p>"),
    "<p><u>Souligné</u> et <s>barré</s></p>",
  );
});

test("sanitizeRichTextHtml treats a missing value as empty", () => {
  assert.equal(sanitizeRichTextHtml(null), "");
  assert.equal(sanitizeRichTextHtml(undefined), "");
  assert.equal(sanitizeRichTextHtml(""), "");
});

test("hasRichTextContent ignores empty editor leftovers", () => {
  assert.equal(hasRichTextContent(null), false);
  assert.equal(hasRichTextContent(""), false);
  assert.equal(hasRichTextContent("<p></p>"), false);
  assert.equal(hasRichTextContent("<p>&nbsp;</p><br>"), false);
  assert.equal(hasRichTextContent("   \n "), false);
});

test("hasRichTextContent detects visible text", () => {
  assert.equal(hasRichTextContent("<p>Bonjour</p>"), true);
  assert.equal(hasRichTextContent("Texte brut"), true);
});
