import assert from "node:assert/strict";
import { test } from "node:test";

import { createProductSchema, productSchema } from "./product";

const translate = (key: string) => key;

const validProduct = {
  name: "Enceinte JBL",
  description: "",
  aiContext: "",
  categoryIds: [],
  price: "10",
  deposit: "",
  quantity: "1",
  status: "active" as const,
  images: [
    "/files/store-id/products/run-1-ai.webp",
    "/files/store-id/products/run-2-ai.webp",
    "/files/store-id/products/run-3-ai.webp",
  ],
  imageHistory: [
    {
      id: "history-1",
      versions: [
        {
          id: "version-1",
          url: "/files/store-id/products/run-1.webp",
          kind: "original" as const,
        },
        {
          id: "version-2",
          url: "/files/store-id/products/run-1-ai.webp",
          kind: "ai-enhanced" as const,
          createdAt: "2026-07-31T14:00:00.000Z",
        },
      ],
    },
  ],
  stockKind: "returnable",
  pricingKind: "duration" as const,
  pricingMode: "day" as const,
  basePriceDuration: { price: "10", duration: 1, unit: "day" as const },
  pricingTiers: [],
  rateTiers: [],
  enforceStrictTiers: true,
  taxSettings: { inheritFromStore: true },
  videoUrl: "",
  accessories: [],
  trackUnits: false,
  units: [],
  bookingAttributeAxes: [],
};

test("accepts multiple same-origin product image paths returned by proxied storage", () => {
  assert.equal(createProductSchema(translate).safeParse(validProduct).success, true);
  assert.equal(productSchema.safeParse(validProduct).success, true);
});

test("keeps rejecting protocol-relative product image URLs", () => {
  const product = {
    ...validProduct,
    images: ["//external.example/products/image.webp"],
  };

  assert.equal(createProductSchema(translate).safeParse(product).success, false);
  assert.equal(productSchema.safeParse(product).success, false);
});

test("validates every URL stored in product image history", () => {
  const product = {
    ...validProduct,
    imageHistory: [
      {
        id: "history-1",
        versions: [
          {
            id: "version-1",
            url: "//external.example/products/image.webp",
            kind: "original" as const,
          },
        ],
      },
    ],
  };

  assert.equal(createProductSchema(translate).safeParse(product).success, false);
  assert.equal(productSchema.safeParse(product).success, false);
});

test("accepts a fixed-price consumable without tracked units", () => {
  const product = {
    ...validProduct,
    stockKind: "consumable",
    pricingKind: "fixed",
  };

  assert.equal(createProductSchema(translate).safeParse(product).success, true);
  assert.equal(productSchema.safeParse(product).success, true);
});

test("ignores incomplete duration fields when fixed pricing is selected", () => {
  const product = {
    ...validProduct,
    stockKind: "consumable",
    pricingKind: "fixed",
    basePriceDuration: { price: "", duration: 0, unit: "day" as const },
    pricingTiers: [{ minDuration: 0, discountPercent: 100 }],
    rateTiers: [
      {
        price: "",
        duration: 0,
        unit: "day" as const,
        discountPercent: 100,
      },
    ],
  };

  assert.equal(createProductSchema(translate).safeParse(product).success, true);
  assert.equal(productSchema.safeParse(product).success, true);
});

test("accepts a free fixed-price consumable", () => {
  const product = {
    ...validProduct,
    price: "0",
    stockKind: "consumable",
    pricingKind: "fixed",
  };

  assert.equal(createProductSchema(translate).safeParse(product).success, true);
  assert.equal(productSchema.safeParse(product).success, true);
});

test("keeps rejecting a free fixed-price returnable product", () => {
  const product = {
    ...validProduct,
    price: "0",
    stockKind: "returnable",
    pricingKind: "fixed",
  };

  assert.equal(createProductSchema(translate).safeParse(product).success, false);
  assert.equal(productSchema.safeParse(product).success, false);
});

test("keeps rejecting a zero duration rate", () => {
  const product = {
    ...validProduct,
    basePriceDuration: { ...validProduct.basePriceDuration, price: "0" },
  };

  assert.equal(createProductSchema(translate).safeParse(product).success, false);
  assert.equal(productSchema.safeParse(product).success, false);
});

test("rejects a duration-priced consumable", () => {
  const product = {
    ...validProduct,
    stockKind: "consumable",
    pricingKind: "duration",
  };

  assert.equal(createProductSchema(translate).safeParse(product).success, false);
  assert.equal(productSchema.safeParse(product).success, false);
});

test("rejects tracked units for a consumable", () => {
  const product = {
    ...validProduct,
    stockKind: "consumable",
    pricingKind: "fixed",
    trackUnits: true,
    units: [{ identifier: "MEDIA-001" }],
  };

  assert.equal(createProductSchema(translate).safeParse(product).success, false);
  assert.equal(productSchema.safeParse(product).success, false);
});

test("normalizes a bare accessory id into an optional single-unit link", () => {
  const product = {
    ...validProduct,
    accessories: ["accessory-1"],
  };

  const parsed = productSchema.safeParse(product);
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.success ? parsed.data.accessories : null, [
    { accessoryId: "accessory-1", required: false, quantity: 1 },
  ]);
});

test("keeps the required flag and quantity of a detailed accessory link", () => {
  const product = {
    ...validProduct,
    accessories: [{ accessoryId: "accessory-1", required: true, quantity: 2 }],
  };

  const clientParsed = createProductSchema(translate).safeParse(product);
  assert.equal(clientParsed.success, true);
  assert.deepEqual(clientParsed.success ? clientParsed.data.accessories : null, [
    { accessoryId: "accessory-1", required: true, quantity: 2 },
  ]);
  assert.equal(productSchema.safeParse(product).success, true);
});

test("rejects an accessory link with a quantity below one", () => {
  const product = {
    ...validProduct,
    accessories: [{ accessoryId: "accessory-1", required: true, quantity: 0 }],
  };

  assert.equal(createProductSchema(translate).safeParse(product).success, false);
  assert.equal(productSchema.safeParse(product).success, false);
});
