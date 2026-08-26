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
  accessoryIds: [],
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
