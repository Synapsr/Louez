import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateGrossFromNet } from "./net-gross-price";

describe("calculateGrossFromNet", () => {
  it("calculates gross price from net with default 23% VAT", () => {
    assert.equal(calculateGrossFromNet(100), 123);
    assert.equal(calculateGrossFromNet(250), 307.5);
    assert.equal(calculateGrossFromNet(0), 0);
  });

  it("rounds to cents accurately", () => {
    assert.equal(calculateGrossFromNet(99.99, 23), 122.99);
  });
});
