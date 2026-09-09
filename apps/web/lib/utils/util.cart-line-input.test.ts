import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { AccessoryLink } from "@/lib/storefront/storefront.types";
import { toCartLineInput } from "@/lib/utils/util.cart-line-input";

const requiredAccessory: AccessoryLink = {
  id: "helmet",
  name: "Casque",
  price: "5",
  deposit: "0",
  images: ["helmet.jpg"],
  quantity: 10,
  required: true,
  requiredQuantity: 2,
  pricingMode: "day",
};

const optionalAccessory: AccessoryLink = {
  id: "lock",
  name: "Antivol",
  price: "2",
  deposit: "0",
  images: null,
  quantity: null,
  required: false,
  pricingMode: null,
};

describe("toCartLineInput", () => {
  test("builds the cart line from a catalog product and keeps the pricing flags", () => {
    const line = toCartLineInput(
      {
        id: "bike",
        name: "Vélo",
        images: ["bike.jpg", "bike-2.jpg"],
        price: "25,50",
        deposit: "150.00",
        stockKind: "returnable",
        pricingKind: null,
        pricingMode: "day",
        basePeriodMinutes: null,
        enforceStrictTiers: true,
        pricingTiers: [{ id: "t3", minDuration: 3, discountPercent: "10", displayOrder: 0 }],
        seasonalPricings: [
          {
            id: "summer",
            name: "Été",
            startDate: "2026-07-01",
            endDate: "2026-08-31",
            basePrice: 30,
            tiers: [],
            rates: [],
          },
        ],
        accessories: [requiredAccessory, optionalAccessory],
      },
      { quantity: 2, maxQuantity: 5, selectedAttributes: { size: "M" } },
    );

    assert.deepEqual(line, {
      productId: "bike",
      productName: "Vélo",
      productImage: "bike.jpg",
      price: 25.5,
      deposit: 150,
      quantity: 2,
      maxQuantity: 5,
      pricingKind: "duration",
      stockKind: "returnable",
      pricingMode: "day",
      productPricingMode: "day",
      basePeriodMinutes: null,
      enforceStrictTiers: true,
      pricingTiers: [{ id: "t3", minDuration: 3, discountPercent: 10, period: null, price: null }],
      seasonalPricings: [
        {
          id: "summer",
          name: "Été",
          startDate: "2026-07-01",
          endDate: "2026-08-31",
          basePrice: 30,
          tiers: [],
          rates: [],
        },
      ],
      selectedAttributes: { size: "M" },
      requiredAccessories: [
        {
          productId: "helmet",
          productName: "Casque",
          productImage: "helmet.jpg",
          price: 5,
          deposit: 0,
          maxQuantity: 10,
          requiredQuantity: 2,
          pricingKind: "duration",
          pricingMode: "day",
          productPricingMode: "day",
          basePeriodMinutes: null,
          pricingTiers: undefined,
        },
      ],
    });
  });

  test("an accessory becomes a line of its own, with no required accessories", () => {
    const line = toCartLineInput(optionalAccessory, {
      quantity: 1,
      maxQuantity: null,
      requiredAccessories: [],
    });

    assert.deepEqual(line, {
      productId: "lock",
      productName: "Antivol",
      productImage: null,
      price: 2,
      deposit: 0,
      quantity: 1,
      maxQuantity: null,
      pricingKind: "duration",
      stockKind: undefined,
      pricingMode: "day",
      productPricingMode: null,
      basePeriodMinutes: null,
      enforceStrictTiers: false,
      pricingTiers: [],
      seasonalPricings: undefined,
      selectedAttributes: undefined,
      requiredAccessories: [],
    });
  });

  test("an explicit image wins over the product images", () => {
    const line = toCartLineInput(
      { id: "p", name: "P", images: ["a.jpg"], price: "1" },
      { quantity: 1, maxQuantity: 1, productImage: null },
    );

    assert.equal(line.productImage, null);
  });
});
