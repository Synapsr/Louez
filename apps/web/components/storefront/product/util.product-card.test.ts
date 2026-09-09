import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AccessoryLink, StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";

import {
  buildProductHref,
  getQuickAddLimit,
  getStockAvailability,
  isNoteworthyAvailability,
  isQuickAddableProduct,
  toProductCardAvailability,
} from "./util.product-card";

const baseProduct: StorefrontCatalogProduct = {
  id: "p1",
  name: "Kayak",
  images: null,
  price: "30",
  quantity: 3,
};

/** Quick add no longer reads the axes; the type says so, the tests must still pass one. */
const productWithAxes: StorefrontCatalogProduct = {
  ...baseProduct,
  bookingAttributeAxes: [{ key: "size", label: "Taille", position: 0 }],
};

const accessory = (overrides: Partial<AccessoryLink>): AccessoryLink => ({
  id: "a1",
  name: "Pagaie",
  price: "5",
  deposit: "0",
  images: null,
  quantity: 2,
  pricingMode: null,
  ...overrides,
});

describe("isQuickAddableProduct", () => {
  it("accepts a product without axes or accessories", () => {
    assert.equal(isQuickAddableProduct(baseProduct), true);
  });

  it("accepts a product with variant axes: the dialog asks for one", () => {
    assert.equal(isQuickAddableProduct(productWithAxes), true);
  });

  it("accepts a product with an optional accessory: it is offered after the add", () => {
    assert.equal(
      isQuickAddableProduct({ ...baseProduct, accessories: [accessory({ required: false })] }),
      true,
    );
  });

  it("accepts a product whose required accessory is in stock", () => {
    assert.equal(
      isQuickAddableProduct({ ...baseProduct, accessories: [accessory({ required: true })] }),
      true,
    );
  });

  it("refuses a product whose required accessory is out of stock", () => {
    assert.equal(
      isQuickAddableProduct({
        ...baseProduct,
        accessories: [accessory({ required: true, quantity: 0 })],
      }),
      false,
    );
  });
});

describe("getQuickAddLimit", () => {
  it("uses the stock when no availability is known", () => {
    assert.equal(getQuickAddLimit(baseProduct), 3);
  });

  it("is unlimited for untracked stock", () => {
    assert.equal(
      getQuickAddLimit({ ...baseProduct, stockKind: "untracked", quantity: null }),
      null,
    );
  });

  it("uses the period availability when given", () => {
    assert.equal(getQuickAddLimit(baseProduct, { status: "limited", availableQuantity: 1 }), 1);
  });

  it("is absent when nothing is bookable", () => {
    assert.equal(getQuickAddLimit({ ...baseProduct, quantity: 0 }), undefined);
    assert.equal(
      getQuickAddLimit(baseProduct, { status: "unavailable", availableQuantity: 0 }),
      undefined,
    );
  });

  it("is the stock for a product with choices: the variant narrows it later", () => {
    assert.equal(getQuickAddLimit(productWithAxes), 3);
  });
});

describe("isNoteworthyAvailability", () => {
  it("says nothing without an availability", () => {
    assert.equal(isNoteworthyAvailability(null), false);
  });

  it("stays quiet on a full stock", () => {
    assert.equal(isNoteworthyAvailability({ status: "available", availableQuantity: 2 }), false);
    assert.equal(isNoteworthyAvailability({ status: "available", availableQuantity: null }), false);
  });

  it("announces the last unit", () => {
    assert.equal(isNoteworthyAvailability({ status: "available", availableQuantity: 1 }), true);
  });

  it("announces a stock the dates have nearly emptied", () => {
    assert.equal(isNoteworthyAvailability({ status: "limited", availableQuantity: 3 }), true);
    assert.equal(isNoteworthyAvailability({ status: "limited", availableQuantity: 4 }), false);
  });

  it("always speaks when the product is blocked or already in the cart", () => {
    assert.equal(isNoteworthyAvailability({ status: "out_of_stock", availableQuantity: 0 }), true);
    assert.equal(isNoteworthyAvailability({ status: "unavailable", availableQuantity: 0 }), true);
    assert.equal(
      isNoteworthyAvailability({ status: "required_accessory_out_of_stock", availableQuantity: 0 }),
      true,
    );
    assert.equal(isNoteworthyAvailability({ status: "in_cart", availableQuantity: 1 }), true);
  });
});

describe("getStockAvailability", () => {
  it("says nothing while the product is in stock", () => {
    assert.equal(getStockAvailability(baseProduct), null);
    assert.equal(
      getStockAvailability({ ...baseProduct, stockKind: "untracked", quantity: null }),
      null,
    );
  });

  it("flags an empty stock", () => {
    assert.deepEqual(getStockAvailability({ ...baseProduct, quantity: 0 }), {
      status: "out_of_stock",
      availableQuantity: 0,
    });
  });
});

describe("toProductCardAvailability", () => {
  it("is available when every unit is free", () => {
    assert.deepEqual(toProductCardAvailability({ product: baseProduct, availableQuantity: 3 }), {
      status: "available",
      availableQuantity: 3,
    });
  });

  it("is limited when fewer units than the stock are free", () => {
    assert.deepEqual(toProductCardAvailability({ product: baseProduct, availableQuantity: 1 }), {
      status: "limited",
      availableQuantity: 1,
    });
  });

  it("is limited when a tracked count sits on untracked stock", () => {
    assert.deepEqual(
      toProductCardAvailability({
        product: { ...baseProduct, stockKind: "untracked", quantity: null },
        availableQuantity: 2,
      }),
      { status: "limited", availableQuantity: 2 },
    );
  });

  it("keeps the server reason for an empty period", () => {
    assert.equal(
      toProductCardAvailability({
        product: baseProduct,
        availableQuantity: 0,
        reason: "out_of_stock",
      }).status,
      "out_of_stock",
    );
    assert.equal(
      toProductCardAvailability({ product: baseProduct, availableQuantity: 0 }).status,
      "unavailable",
    );
  });

  it("blocks on a required accessory out of stock", () => {
    assert.equal(
      toProductCardAvailability({
        product: { ...baseProduct, accessories: [accessory({ required: true, quantity: 0 })] },
        availableQuantity: 3,
      }).status,
      "required_accessory_out_of_stock",
    );
  });
});

describe("buildProductHref", () => {
  it("links to the product page without dates", () => {
    assert.equal(buildProductHref("p1"), "/product/p1");
  });

  it("carries the period as query params", () => {
    assert.equal(
      buildProductHref("p1", {
        startDate: "2026-09-10T07:00:00.000Z",
        endDate: "2026-09-12T16:00:00.000Z",
      }),
      "/product/p1?startDate=2026-09-10T07%3A00%3A00.000Z&endDate=2026-09-12T16%3A00%3A00.000Z",
    );
  });
});
