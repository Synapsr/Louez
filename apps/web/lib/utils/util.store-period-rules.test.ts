import assert from "node:assert/strict";
import { test } from "node:test";

import { getStorePeriodRules } from "./util.store-period-rules";

test("missing settings fall back to the store defaults", () => {
  assert.deepEqual(getStorePeriodRules(null), {
    pricingMode: "day",
    businessHours: undefined,
    timezone: undefined,
    advanceNoticeMinutes: 0,
    minRentalMinutes: 60,
    maxRentalMinutes: null,
  });
});

test("store settings flow through unchanged", () => {
  const rules = getStorePeriodRules({
    timezone: "Europe/Paris",
    advanceNoticeMinutes: 120,
    minRentalMinutes: 1440,
    maxRentalMinutes: 20160,
  });

  assert.equal(rules.timezone, "Europe/Paris");
  assert.equal(rules.advanceNoticeMinutes, 120);
  assert.equal(rules.minRentalMinutes, 1440);
  assert.equal(rules.maxRentalMinutes, 20160);
});
