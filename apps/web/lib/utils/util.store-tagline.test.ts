import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getStoreTagline } from "./util.store-tagline";

describe("getStoreTagline", () => {
  it("is null for an empty description", () => {
    assert.equal(getStoreTagline(null), null);
    assert.equal(getStoreTagline("<p></p>"), null);
    assert.equal(getStoreTagline("<p>&nbsp;</p>"), null);
  });

  it("keeps the first sentence without markup", () => {
    assert.equal(
      getStoreTagline("<p>Location de <strong>kayaks</strong> à Brest. Ouvert toute l'année.</p>"),
      "Location de kayaks à Brest.",
    );
  });

  it("keeps a description without punctuation whole", () => {
    assert.equal(getStoreTagline("Location de vélos en Bretagne"), "Location de vélos en Bretagne");
  });

  it("caps a long sentence on a word boundary", () => {
    const tagline = getStoreTagline(`${"mot ".repeat(50)}fin.`);
    assert.ok(tagline !== null && tagline.length <= 141);
    assert.ok(tagline?.endsWith("…"));
  });
});
