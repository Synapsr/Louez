import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isPartnerStatementPath, partnerStatementUrl } from "./partner-statement-path";
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

  test("the statement page lives on the dashboard's address", () => {
    assert.equal(
      partnerStatementUrl("https://app.louez.io/", "abc"),
      "https://app.louez.io/partner-statements/abc",
    );
    assert.equal(isPartnerStatementPath("/partner-statements/abc"), true);
    assert.equal(isPartnerStatementPath("/partner-statementsx"), false);
  });
});
