import assert from "node:assert/strict";
import { test } from "node:test";

import { cardBrandName, formatDay, formatMinor, formatPeriod } from "./billing-format";

// How the billing pages write the service's amounts, months and dates (README §3).

test("amounts are minor units of their currency", () => {
  assert.equal(formatMinor(12_345, "EUR", "en"), "€123.45");
  assert.equal(formatMinor(-500, "EUR", "en"), "-€5.00");
  assert.equal(formatMinor(1_200, "JPY", "en"), "¥1,200");
});

test("a period is a UTC month, written as a title", () => {
  assert.equal(formatPeriod("2026-10", "en"), "October 2026");
  assert.equal(formatPeriod("2026-01", "fr"), "Janvier 2026");
});

test("a date is the day in the store's time zone", () => {
  assert.equal(formatDay("2026-11-30T23:30:00Z", "Europe/Paris", "en"), "December 1, 2026");
  assert.equal(formatDay("2026-11-30T23:30:00Z", "UTC", "en"), "November 30, 2026");
});

test("a card brand is written as people write it, an unknown one as Stripe names it", () => {
  assert.equal(cardBrandName("visa"), "Visa");
  assert.equal(cardBrandName("cartes_bancaires"), "Cartes Bancaires");
  assert.equal(cardBrandName("link"), "link");
  assert.equal(cardBrandName("unknown"), null);
  assert.equal(cardBrandName(null), null);
});
