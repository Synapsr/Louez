import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stripHtml, truncateText } from "./util.seo-text";

describe("stripHtml", () => {
  it("keeps a space between paragraphs and list items", () => {
    assert.equal(
      stripHtml(
        "<p>Location à Concarneau.</p><p>Depuis 2019.</p><ul><li>Vélos</li><li>Kayaks</li></ul>",
      ),
      "Location à Concarneau. Depuis 2019. Vélos Kayaks",
    );
  });

  it("removes inline tags without adding spaces", () => {
    assert.equal(
      stripHtml("<p>Un <strong>VAE</strong> <em>confort</em>able</p>"),
      "Un VAE confortable",
    );
  });

  it("collapses whitespace and non-breaking spaces", () => {
    assert.equal(
      stripHtml("  <p>Ouvert&nbsp;7j/7</p>\n\n<p>  Sur   réservation </p> "),
      "Ouvert 7j/7 Sur réservation",
    );
  });
});

describe("truncateText", () => {
  it("leaves short text alone", () => {
    assert.equal(truncateText("court", 160), "court");
  });

  it("cuts to the limit with an ellipsis", () => {
    const text = truncateText("a".repeat(200), 160);
    assert.equal(text.length, 160);
    assert.ok(text.endsWith("..."));
  });
});
