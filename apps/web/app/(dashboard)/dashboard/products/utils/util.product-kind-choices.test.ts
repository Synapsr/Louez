import assert from "node:assert/strict";
import { test } from "node:test";

import {
  STOCK_OPTIONS,
  getPricingKindImpact,
  getStockOption,
  getStockOptionFields,
  getStockOptionImpact,
} from "./util.product-kind-choices";

test("maps every stock option to its fields and back", () => {
  for (const option of STOCK_OPTIONS) {
    assert.equal(getStockOption(getStockOptionFields(option)), option);
  }
});

test("reads a product without a stock kind as a simple quantity", () => {
  assert.equal(getStockOption({}), "quantity");
  assert.equal(getStockOption({ stockKind: "returnable", trackUnits: true }), "units");
});

test("never tracks units outside returnable stock", () => {
  assert.equal(getStockOption({ stockKind: "consumable", trackUnits: true }), "consumable");
  for (const option of STOCK_OPTIONS) {
    const fields = getStockOptionFields(option);
    assert.ok(fields.stockKind === "returnable" || !fields.trackUnits);
  }
});

test("a consumable switches duration pricing to a flat rate", () => {
  const context = { current: "quantity" as const, stockKindLocked: false, unitCount: 0 };
  assert.equal(
    getStockOptionImpact("consumable", { ...context, pricingKind: "duration" })
      .switchesToFixedPrice,
    true,
  );
  assert.equal(
    getStockOptionImpact("consumable", { ...context, pricingKind: "fixed" }).switchesToFixedPrice,
    false,
  );
});

test("reservations lock the stock kind but not the returnable modes", () => {
  const context = {
    current: "quantity" as const,
    pricingKind: "fixed" as const,
    stockKindLocked: true,
    unitCount: 0,
  };
  assert.equal(getStockOptionImpact("units", context).blockedByReservations, false);
  assert.equal(getStockOptionImpact("consumable", context).blockedByReservations, true);
  assert.equal(getStockOptionImpact("untracked", context).blockedByReservations, true);
});

test("leaving unit tracking removes registered units only", () => {
  const context = { current: "units" as const, stockKindLocked: false };
  assert.equal(getStockOptionImpact("quantity", { ...context, unitCount: 3 }).removesUnits, true);
  assert.equal(getStockOptionImpact("quantity", { ...context, unitCount: 0 }).removesUnits, false);
  assert.equal(getStockOptionImpact("units", { ...context, unitCount: 3 }).removesUnits, false);
});

test("duration pricing turns a consumable into a quantity unless reservations lock it", () => {
  assert.deepEqual(
    getPricingKindImpact("duration", { stockKind: "consumable", stockKindLocked: false }),
    {
      blockedByReservations: false,
      switchesStockToQuantity: true,
    },
  );
  assert.deepEqual(
    getPricingKindImpact("duration", { stockKind: "consumable", stockKindLocked: true }),
    {
      blockedByReservations: true,
      switchesStockToQuantity: false,
    },
  );
  assert.deepEqual(
    getPricingKindImpact("fixed", { stockKind: "consumable", stockKindLocked: true }),
    {
      blockedByReservations: false,
      switchesStockToQuantity: false,
    },
  );
});
