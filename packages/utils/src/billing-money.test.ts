import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { beforeTaxRateBps, normalizeCurrency } from "./billing-money";

describe("beforeTaxRateBps", () => {
  test("is the default rate of a store that prices excluding tax, and null otherwise", () => {
    const tax = { enabled: true, defaultRate: 5.5, displayMode: "exclusive" as const };
    assert.equal(beforeTaxRateBps(tax), 550);
    assert.equal(beforeTaxRateBps({ ...tax, taxLabel: "VAT", taxNumber: "FR1" }), 550);
    assert.equal(beforeTaxRateBps({ ...tax, displayMode: "inclusive" }), null);
    assert.equal(beforeTaxRateBps({ ...tax, enabled: false }), null);
    assert.equal(beforeTaxRateBps(undefined), null);
  });
});

describe("normalizeCurrency", () => {
  test("upper-cases a three-letter code and falls back otherwise", () => {
    assert.equal(normalizeCurrency(" usd "), "USD");
    assert.equal(normalizeCurrency(null), "EUR");
    assert.equal(normalizeCurrency("euro", "CHF"), "CHF");
  });
});
