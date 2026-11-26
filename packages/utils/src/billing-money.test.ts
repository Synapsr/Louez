import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  beforeTaxRateBps,
  currencyMinorDigits,
  exactMoneyDecimals,
  normalizeCurrency,
  roundDownToMinorUnit,
} from "./billing-money";

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

describe("currencyMinorDigits", () => {
  test("is none for a zero-decimal currency, two otherwise, and null for a three-decimal one", () => {
    assert.equal(currencyMinorDigits("JPY"), 0);
    assert.equal(currencyMinorDigits("krw"), 0);
    assert.equal(currencyMinorDigits("EUR"), 2);
    assert.equal(currencyMinorDigits("CHF"), 2);
    assert.equal(currencyMinorDigits("KWD"), null);
  });
});

describe("roundDownToMinorUnit", () => {
  test("rounds down to whole units in a zero-decimal currency, never up", () => {
    assert.equal(roundDownToMinorUnit(100.6, "JPY"), 100);
    assert.equal(roundDownToMinorUnit(100.99, "jpy"), 100);
    assert.equal(roundDownToMinorUnit(7000, "JPY"), 7000);
  });

  test("keeps the cents of a two-decimal currency, counted in hundredths", () => {
    assert.equal(roundDownToMinorUnit(0.29, "EUR"), 0.29);
    assert.equal(roundDownToMinorUnit(21, "EUR"), 21);
    assert.equal(roundDownToMinorUnit(0.1 + 0.2, "USD"), 0.3);
  });
});

describe("exactMoneyDecimals", () => {
  test("writes every digit a stored amount holds, and leaves off zeros past the currency's own", () => {
    assert.equal(exactMoneyDecimals("1500.00", "JPY"), 0);
    assert.equal(exactMoneyDecimals("1.49", "JPY"), 2);
    assert.equal(exactMoneyDecimals("3.50", "EUR"), 2);
    assert.equal(exactMoneyDecimals("3", "EUR"), 0);
    assert.equal(exactMoneyDecimals("1.23", "KWD"), 2);
  });
});
