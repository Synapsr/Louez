import assert from "node:assert/strict";
import { test } from "node:test";

import type { PricingBreakdown } from "@louez/types";

import { linePricingKind } from "./pricing-facts";

const breakdown = (fields: Partial<PricingBreakdown>): PricingBreakdown => ({
  basePrice: 30,
  effectivePrice: 30,
  duration: 1,
  pricingMode: "day",
  discountPercent: null,
  discountAmount: 0,
  tierApplied: null,
  ...fields,
});

test("the product says the kind while it exists, whatever the line recorded", () => {
  assert.equal(
    linePricingKind({
      product: { pricingKind: "duration" },
      pricingBreakdown: breakdown({ pricingKind: "fixed" }),
    }),
    "duration",
  );
  assert.equal(linePricingKind({ product: { pricingKind: "fixed" } }), "fixed");
});

test("once the product is gone, the kind the line recorded, a facts-only breakdown included", () => {
  assert.equal(
    linePricingKind({ product: null, pricingBreakdown: breakdown({ pricingKind: "fixed" }) }),
    "fixed",
  );
  assert.equal(
    linePricingKind({
      product: null,
      pricingBreakdown: breakdown({ pricingKind: "fixed", factsOnly: true, promotion: null }),
    }),
    "fixed",
  );
});

test("a line that recorded no kind is priced per period", () => {
  assert.equal(linePricingKind({ product: null, pricingBreakdown: breakdown({}) }), "duration");
  assert.equal(linePricingKind({ product: null, pricingBreakdown: null }), "duration");
  assert.equal(linePricingKind({}), "duration");
});
