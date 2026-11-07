import assert from "node:assert/strict";
import { test } from "node:test";

import { PRODUCT_LIST_LIMITS } from "@louez/validations";

import { remainingListSlots } from "./util.product-list-limits";

test("an editor may add up to the API's limit, and nothing past it", () => {
  assert.equal(remainingListSlots("units", 0), PRODUCT_LIST_LIMITS.units);
  assert.equal(remainingListSlots("units", 990), 10);
  assert.equal(remainingListSlots("units", 1000), 0);
  assert.equal(remainingListSlots("rateTiers", 49), 1);
  assert.equal(remainingListSlots("rateTiers", 50), 0);
  // A product stored with more than the limit adds nothing, and keeps what it has.
  assert.equal(remainingListSlots("units", 1200), 0);
});
