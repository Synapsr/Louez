import assert from "node:assert/strict";
import { test } from "node:test";

import { isPartnerSpacePath, partnerSpaceUrl } from "./partner-code";

test("the partner's space lives on the dashboard's address", () => {
  assert.equal(partnerSpaceUrl("https://app.louez.io/", "abc"), "https://app.louez.io/partner/abc");
  assert.equal(
    partnerSpaceUrl("https://app.louez.io/dashboard", "abc"),
    "https://app.louez.io/partner/abc",
  );
  assert.equal(isPartnerSpacePath("/partner/abc"), true);
  assert.equal(isPartnerSpacePath("/partners"), false);
});
