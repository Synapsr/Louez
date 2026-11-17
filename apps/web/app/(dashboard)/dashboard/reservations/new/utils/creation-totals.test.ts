import assert from "node:assert/strict";
import { test } from "node:test";

import { creationTotals } from "./creation-totals";

// The creation form shows the total the server writes: the numbers of
// edit-totals.db.test.ts ("a creation by hand"), for the same lines. Two of a
// product at 10.00 a day for two days (40.00, at the store's rate), a custom
// line of 20.00, 4.00 off, 12.50 of insurance.
const cart = {
  productLines: [{ subtotal: 40, unitPrice: 20, typed: false, taxSettings: null }],
  customLines: [{ subtotal: 20, unitPrice: 20 }],
  insuranceAmount: 12.5,
  deliveryFee: 0,
  discountAmount: 4,
  deposit: 0,
  currency: "USD",
};

test("prices before tax: the tax on top, as the server writes it", () => {
  const totals = creationTotals({
    ...cart,
    taxSettings: { enabled: true, defaultRate: 20, displayMode: "exclusive" },
  });
  assert.deepEqual([totals.total, totals.taxAmount], [79.7, 11.2]);
});

test("prices with tax: what the prices add up to, as the server writes it", () => {
  const totals = creationTotals({
    ...cart,
    taxSettings: { enabled: true, defaultRate: 20, displayMode: "inclusive" },
  });
  assert.equal(totals.total, 68.5);
});

test("taxes off: what the prices add up to", () => {
  const totals = creationTotals({ ...cart, taxSettings: undefined });
  assert.deepEqual([totals.total, totals.taxAmount], [68.5, null]);
});

test("a line of 150.00 before tax at 20 % shows 180.00", () => {
  const totals = creationTotals({
    productLines: [{ subtotal: 150, unitPrice: 150, typed: false, taxSettings: null }],
    customLines: [],
    insuranceAmount: 0,
    deliveryFee: 0,
    discountAmount: 0,
    deposit: 0,
    currency: "EUR",
    taxSettings: { enabled: true, defaultRate: 20, displayMode: "exclusive" },
  });
  assert.equal(totals.total, 180);
});
