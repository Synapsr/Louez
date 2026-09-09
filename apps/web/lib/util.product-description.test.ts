import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeProductDescriptionHtml } from "./util.product-description";

test("preserves rich text formatting produced by the product editor", () => {
  const description = "<p>Vélo <strong>équipé</strong></p><ul><li><p>Casque</p></li></ul>";

  assert.equal(sanitizeProductDescriptionHtml(description), description);
});

test("keeps underline, which the editor emits on Cmd+U", () => {
  assert.equal(
    sanitizeProductDescriptionHtml("<p><u>Souligné</u> et <s>barré</s></p>"),
    "<p><u>Souligné</u> et <s>barré</s></p>",
  );
});

test("preserves plain text line breaks", () => {
  assert.equal(
    sanitizeProductDescriptionHtml("Première ligne\nDeuxième ligne"),
    "Première ligne<br>Deuxième ligne",
  );
});

test("keeps safe links and removes unsupported attributes", () => {
  assert.equal(
    sanitizeProductDescriptionHtml(
      '<a href="https://example.com?a=1&amp;b=2" target="_blank" onclick="alert(1)">Lien</a>',
    ),
    '<a href="https://example.com?a=1&amp;b=2" rel="noopener noreferrer">Lien</a>',
  );
});

test("drops unsupported tags but keeps their text", () => {
  assert.equal(
    sanitizeProductDescriptionHtml('<p><span style="color:red">Rouge</span> <code>x</code></p>'),
    "<p>Rouge x</p>",
  );
});

test("keeps a stray comparison sign in plain text", () => {
  assert.equal(
    sanitizeProductDescriptionHtml("Poids < 10 kg > 5 kg"),
    "Poids &lt; 10 kg &gt; 5 kg",
  );
});

test("neutralizes executable markup and unsafe links", () => {
  assert.equal(
    sanitizeProductDescriptionHtml(
      '<img src=x onerror="alert(1)"><script>alert(2)</script><a href="java&#115;cript:alert(3)">Lien</a>',
    ),
    "alert(2)<a>Lien</a>",
  );
});
