import assert from "node:assert/strict";
import { test } from "node:test";

import { SUPPORTED_CURRENCY_CODES } from "@louez/utils";

import { SUPPORTED_CURRENCIES } from "./currency";

test("the currency picker offers every currency a store may use, and only those", () => {
  assert.deepEqual(
    SUPPORTED_CURRENCIES.map((currency) => currency.code).sort(),
    [...SUPPORTED_CURRENCY_CODES].sort(),
  );
});
