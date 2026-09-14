import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSlug, pickUniqueSlug, slugify } from "./slug";

describe("slugify", () => {
  it("folds accents and punctuation into hyphens", () => {
    assert.equal(slugify("VAE trekking Riverside 540 E"), "vae-trekking-riverside-540-e");
    assert.equal(slugify('  Vélo électrique — enfant (20") '), "velo-electrique-enfant-20");
    assert.equal(slugify("Cœur & Œuvre"), "coeur-oeuvre");
  });

  it("yields an empty slug for a name without letters or digits", () => {
    assert.equal(slugify("🚲"), "");
  });

  it("caps the length without leaving a dangling hyphen", () => {
    const slug = slugify(`${"a".repeat(79)} b`);
    assert.equal(slug.length, 79);
    assert.ok(isSlug(slug));
  });
});

describe("pickUniqueSlug", () => {
  it("returns the base when free, then numbers it", () => {
    assert.equal(pickUniqueSlug("velo", new Set()), "velo");
    assert.equal(pickUniqueSlug("velo", new Set(["velo"])), "velo-2");
    assert.equal(pickUniqueSlug("velo", new Set(["velo", "velo-2"])), "velo-3");
  });

  it("falls back when the base is empty", () => {
    assert.equal(pickUniqueSlug("", new Set(["item"])), "item-2");
  });
});

describe("isSlug", () => {
  it("accepts slugify output and rejects ids and uppercase", () => {
    assert.ok(isSlug("velo-de-ville-2"));
    assert.ok(!isSlug("-VYH84RWxlN0dcOsIMyJf"));
    assert.ok(!isSlug("Velo"));
    assert.ok(!isSlug(""));
  });
});
