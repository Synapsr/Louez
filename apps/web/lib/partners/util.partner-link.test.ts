import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isPartnerSpacePath, partnerSpaceUrl } from "./partner-space-path";
import { partnerLinkUrl } from "./util.partner-link";

describe("partner links", () => {
  test("adds the partner's code to the store's address, keeping its path", () => {
    assert.equal(
      partnerLinkUrl("https://velo-evasion.louez.io/", "les-pins"),
      "https://velo-evasion.louez.io/?partner=les-pins",
    );
    assert.equal(
      partnerLinkUrl("https://louez.example/velo-evasion/catalog?x=1", "les-pins"),
      "https://louez.example/velo-evasion/catalog?x=1&partner=les-pins",
    );
  });

  test("the partner's space lives on the dashboard's address", () => {
    assert.equal(
      partnerSpaceUrl("https://app.louez.io/", "abc"),
      "https://app.louez.io/partner/abc",
    );
    assert.equal(
      partnerSpaceUrl("https://app.louez.io/dashboard", "abc"),
      "https://app.louez.io/partner/abc",
    );
    assert.equal(isPartnerSpacePath("/partner/abc"), true);
    assert.equal(isPartnerSpacePath("/partners"), false);
  });
});
