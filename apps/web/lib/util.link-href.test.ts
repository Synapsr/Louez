import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSingleLinkText, normalizeLinkHref } from "./util.link-href";

describe("normalizeLinkHref", () => {
  it("adds https to a bare domain", () => {
    assert.equal(normalizeLinkHref("exemple.fr"), "https://exemple.fr/");
    assert.equal(
      normalizeLinkHref("  location-bourgoin.louez.app/catalog "),
      "https://location-bourgoin.louez.app/catalog",
    );
  });

  it("keeps an explicit http or https scheme", () => {
    assert.equal(normalizeLinkHref("http://exemple.fr/page?a=1"), "http://exemple.fr/page?a=1");
    assert.equal(normalizeLinkHref("https://www.exemple.fr"), "https://www.exemple.fr/");
  });

  it("refuses schemes the storefront sanitiser would strip", () => {
    assert.equal(normalizeLinkHref("javascript:alert(1)"), null);
    assert.equal(normalizeLinkHref("mailto:contact@exemple.fr"), null);
    assert.equal(normalizeLinkHref("tel:+33600000000"), null);
  });

  it("refuses plain words and sentences", () => {
    assert.equal(normalizeLinkHref(""), null);
    assert.equal(normalizeLinkHref("bonjour"), null);
    assert.equal(normalizeLinkHref("voir exemple.fr"), null);
    assert.equal(normalizeLinkHref("https://"), null);
  });
});

describe("isSingleLinkText", () => {
  it("only accepts one address on its own", () => {
    assert.equal(isSingleLinkText("https://exemple.fr/contact"), true);
    assert.equal(isSingleLinkText("exemple.fr"), true);
    assert.equal(isSingleLinkText("Formulaire : exemple.fr"), false);
  });
});
