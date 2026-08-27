import assert from "node:assert/strict";
import { test } from "node:test";

import type { Product, SelectedProduct } from "../types";
import { getLineQuantityConstraints } from "./variant-lines";

const untrackedProduct: Product = {
  id: "cleaning-service",
  name: "Bike cleaning",
  price: "5.00",
  deposit: null,
  quantity: 1,
  stockKind: "untracked",
  pricingKind: "fixed",
  pricingMode: "day",
  images: null,
  trackUnits: false,
  bookingAttributeAxes: null,
  units: [],
  pricingTiers: [],
};

test("dashboard reservation lines do not cap an untracked product", () => {
  const line: SelectedProduct = {
    lineId: "line-1",
    productId: untrackedProduct.id,
    quantity: 50,
  };

  const constraints = getLineQuantityConstraints(untrackedProduct, line, [line], 100);

  assert.equal(constraints.lineMaxQuantity, null);
  assert.equal(constraints.hasBookingAttributes, false);
});
