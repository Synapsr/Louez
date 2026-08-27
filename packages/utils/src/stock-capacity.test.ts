import assert from "node:assert/strict";
import { test } from "node:test";

import {
  combineStockQuantityLimits,
  divideStockQuantityLimit,
  getAvailableStockQuantity,
  isWithinStockQuantityLimit,
} from "./stock-capacity";

test("an untracked product has no stock quantity limit", () => {
  assert.equal(
    getAvailableStockQuantity({
      stockKind: "untracked",
      totalQuantity: 0,
      reservedQuantity: 100,
    }),
    null,
  );
});

test("finite required accessories can limit an untracked parent", () => {
  const accessoryParentLimit = divideStockQuantityLimit(5, 2);

  assert.equal(accessoryParentLimit, 2);
  assert.equal(combineStockQuantityLimits(null, accessoryParentLimit), 2);
  assert.equal(combineStockQuantityLimits(null, null), null);
  assert.equal(isWithinStockQuantityLimit(3, accessoryParentLimit), false);
  assert.equal(isWithinStockQuantityLimit(50, null), true);
});
