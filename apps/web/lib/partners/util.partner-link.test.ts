import assert from "node:assert/strict";
import { describe, test } from "node:test";

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
});
