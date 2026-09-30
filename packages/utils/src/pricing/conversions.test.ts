import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { minutesToPriceDuration, tierDisplayMaxUnit } from "./conversions";

describe("minutesToPriceDuration", () => {
  test("uses the largest unit that divides the period by default", () => {
    assert.deepEqual(minutesToPriceDuration(30240), { duration: 3, unit: "week" });
    assert.deepEqual(minutesToPriceDuration(2880), { duration: 2, unit: "day" });
    assert.deepEqual(minutesToPriceDuration(90), { duration: 90, unit: "minute" });
  });

  test("keeps a day ladder in days when capped at days", () => {
    assert.deepEqual(minutesToPriceDuration(30240, "day"), { duration: 21, unit: "day" });
    assert.deepEqual(minutesToPriceDuration(180, "day"), { duration: 3, unit: "hour" });
  });
});

describe("tierDisplayMaxUnit", () => {
  test("only a weekly base rate lets tiers switch to weeks", () => {
    assert.equal(tierDisplayMaxUnit("week"), "week");
    assert.equal(tierDisplayMaxUnit("day"), "day");
    assert.equal(tierDisplayMaxUnit("hour"), "day");
  });
});
