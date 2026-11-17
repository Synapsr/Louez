import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildSeasonalPricingConfigs,
  toPricingCatalogProduct,
  type PricingProductRow,
  type PricingTierRow,
  type SeasonalPricingRow,
  type SeasonalPricingTierRow,
} from "@louez/api/services/catalogue-line-pricing";
import { priceCartLine } from "@louez/api/services/price-cart";
import type { PricingMode, ProductPromotion, TaxSettings } from "@louez/types";
import { roundToMinorUnit } from "@louez/utils";

import type { Product } from "../types";
import { creationTotals } from "./creation-totals";
import { productLinePricing, typedLineSubtotal } from "./product-line-pricing";

// The creation form's total is the server's (`createManualReservation`) for
// every shape of price: the same products as the page and the server read
// them, priced by the form and by the server's own path, totalled alike.
// Deterministic: every combination of the lists below, no randomness.

const START = new Date("2031-06-10T09:00:00.000Z");
const NOW = new Date("2031-05-01T12:00:00.000Z");
const MINUTES: Record<PricingMode, number> = { hour: 60, day: 24 * 60, week: 7 * 24 * 60 };
const BEFORE_TAX: TaxSettings = { enabled: true, defaultRate: 20, displayMode: "exclusive" };
const WITH_TAX: TaxSettings = { enabled: true, defaultRate: 20, displayMode: "inclusive" };

type Shape =
  | "plain"
  | "tiers"
  | "rates"
  | "strict rates"
  | "fixed"
  | "overlapping seasons"
  | "seasons with rates";
const SHAPES: Shape[] = [
  "plain",
  "tiers",
  "rates",
  "strict rates",
  "fixed",
  "overlapping seasons",
  "seasons with rates",
];
// Prices that land on half cents once a tier or a promotion takes its share.
const PRICES = ["0.29", "5.35", "9.99", "101.00"];
const MODES: PricingMode[] = ["hour", "day", "week"];
/** The window, in periods of the product's mode. */
const LENGTHS = [1, 2.5, 4];
const QUANTITIES = [1, 3];
const CURRENCIES = ["EUR", "JPY"];
const TAXES: Array<TaxSettings | undefined> = [undefined, WITH_TAX, BEFORE_TAX];
const PROMOTIONS: Array<ProductPromotion | null> = [
  null,
  { percentage: 1, startsOn: null, endsOn: null },
  { percentage: 50, startsOn: null, endsOn: null },
];

interface Rows {
  product: PricingProductRow;
  tiers: PricingTierRow[];
  seasons: SeasonalPricingRow[];
  seasonTiers: SeasonalPricingTierRow[];
}

/** A product's rows as the database holds them. */
function rowsOf(
  shape: Shape,
  price: string,
  mode: PricingMode,
  promotion: ProductPromotion | null,
) {
  const period = MINUTES[mode];
  const rated = shape === "rates" || shape === "strict rates" || shape === "seasons with rates";
  const product: PricingProductRow = {
    id: "product",
    name: "Board",
    description: null,
    images: [],
    price,
    deposit: "0.00",
    pricingKind: shape === "fixed" ? "fixed" : "duration",
    pricingMode: mode,
    basePeriodMinutes: rated ? period : null,
    enforceStrictTiers: shape === "strict rates",
    stockKind: "returnable",
    quantity: 50,
    trackUnits: false,
    bookingAttributeAxes: null,
    taxSettings: null,
    promotion,
  };
  const tier = (values: Partial<PricingTierRow>): PricingTierRow => ({
    id: `tier-${values.minDuration ?? values.period}`,
    minDuration: null,
    discountPercent: null,
    displayOrder: 0,
    period: null,
    price: null,
    ...values,
  });
  const tiers: PricingTierRow[] =
    shape === "tiers"
      ? [
          tier({ minDuration: 1, discountPercent: "50.000000" }),
          tier({ minDuration: 3, discountPercent: "12.500000", displayOrder: 1 }),
        ]
      : rated
        ? [tier({ period: 3 * period, price: (Number(price) * 2.5).toFixed(2) })]
        : [];
  const seasonal = shape === "overlapping seasons" || shape === "seasons with rates";
  const seasons: SeasonalPricingRow[] = seasonal
    ? [
        {
          id: "high",
          productId: "product",
          name: "High",
          startDate: "2031-06-01",
          endDate: "2031-06-11",
          price: (Number(price) * 1.5).toFixed(2),
        },
        {
          id: "low",
          productId: "product",
          name: "Low",
          startDate: "2031-06-11",
          endDate: "2031-07-31",
          price: (Number(price) * 0.75).toFixed(2),
        },
      ]
    : [];
  const seasonTiers: SeasonalPricingTierRow[] = seasonal
    ? [
        {
          id: "high-tier",
          seasonalPricingId: "high",
          minDuration: 2,
          discountPercent: "12.500000",
          displayOrder: 0,
          period: null,
          price: null,
        },
      ]
    : [];
  return { product, tiers, seasons, seasonTiers } satisfies Rows;
}

const seasonsOf = (rows: Rows) =>
  buildSeasonalPricingConfigs(rows.seasons, rows.seasonTiers).get(rows.product.id) ?? [];

/** The product as the creation page gives it to the form (`getProductsWithTiers`). */
const formProductOf = (rows: Rows): Product => ({
  ...rows.product,
  units: [],
  pricingTiers: rows.tiers,
  seasonalPricings: seasonsOf(rows),
});

interface Case {
  rows: Rows;
  end: Date;
  quantity: number;
  currency: string;
  tax: TaxSettings | undefined;
  typedUnitPrice?: number;
}

/** The total the form shows and sends. */
function formTotal(input: Case) {
  const product = formProductOf(input.rows);
  const pricing = productLinePricing({
    product,
    selectedItem: {
      lineId: "0",
      productId: product.id,
      quantity: input.quantity,
      ...(input.typedUnitPrice === undefined
        ? {}
        : { priceOverride: { unitPrice: input.typedUnitPrice } }),
    },
    startDate: START,
    endDate: input.end,
    timezone: undefined,
    now: NOW,
  });
  return creationTotals({
    productLines: [
      {
        subtotal: pricing.lineSubtotal,
        unitPrice: pricing.lineUnitPrice,
        typed: pricing.hasPriceOverride,
        taxSettings: null,
      },
    ],
    customLines: [],
    insuranceAmount: 0,
    deliveryFee: 0,
    discountAmount: 0,
    deposit: 0,
    taxSettings: input.tax,
    currency: input.currency,
  });
}

/**
 * The total the server writes: its catalogue entry as `loadPricingCatalog`
 * builds it from the rows, a catalogue line priced by `priceCartLine`, a
 * typed price rounded as `createManualReservation` writes it.
 */
function serverTotal(input: Case) {
  const catalogue = toPricingCatalogProduct(
    input.rows.product,
    input.rows.tiers,
    seasonsOf(input.rows),
  );
  const line =
    input.typedUnitPrice === undefined
      ? {
          ...priceCartLine(
            catalogue,
            {
              productId: catalogue.id,
              quantity: input.quantity,
              startDate: START.toISOString(),
              endDate: input.end.toISOString(),
            },
            NOW,
          ),
          typed: false,
        }
      : {
          subtotal: Number(
            roundToMinorUnit(
              typedLineSubtotal({
                unitPrice: input.typedUnitPrice,
                quantity: input.quantity,
                pricingKind: catalogue.pricingKind,
                pricingMode: catalogue.pricingMode,
                startDate: START,
                endDate: input.end,
              }),
              input.currency,
            ).toFixed(2),
          ),
          unitPrice: Number(roundToMinorUnit(input.typedUnitPrice, input.currency).toFixed(2)),
          typed: true,
          taxSettings: catalogue.taxSettings,
        };
  return creationTotals({
    productLines: [line],
    customLines: [],
    insuranceAmount: 0,
    deliveryFee: 0,
    discountAmount: 0,
    deposit: 0,
    taxSettings: input.tax,
    currency: input.currency,
  });
}

function* cases(): Generator<Case & { name: string }> {
  for (const shape of SHAPES)
    for (const price of PRICES)
      for (const mode of MODES)
        for (const length of LENGTHS)
          for (const quantity of QUANTITIES)
            for (const currency of CURRENCIES)
              for (const [taxIndex, tax] of TAXES.entries())
                for (const promotion of PROMOTIONS)
                  yield {
                    name: `${shape} ${price} ${length} ${mode} ×${quantity} ${currency} tax#${taxIndex} promotion ${promotion?.percentage ?? 0}`,
                    rows: rowsOf(shape, price, mode, promotion),
                    end: new Date(START.getTime() + length * MINUTES[mode] * 60_000),
                    quantity,
                    currency,
                    tax,
                  };
}

test("the form's total is the server's, for every shape of price", () => {
  const mismatches: string[] = [];
  let compared = 0;
  for (const input of cases()) {
    const form = formTotal(input);
    const server = serverTotal(input);
    compared += 1;
    if (form.total !== server.total || form.taxAmount !== server.taxAmount) {
      mismatches.push(`${input.name}: form ${form.total}, server ${server.total}`);
    }
  }
  assert.equal(compared, 9072);
  assert.deepEqual(mismatches, []);
});

test("a price typed by hand: the form's total is the server's, never discounted", () => {
  const mismatches: string[] = [];
  let compared = 0;
  for (const typedUnitPrice of [0.015, 2.675, 100.5])
    for (const mode of MODES)
      for (const kind of ["plain", "fixed"] as const)
        for (const quantity of QUANTITIES)
          for (const currency of CURRENCIES)
            for (const tax of TAXES) {
              const input: Case = {
                rows: rowsOf(kind, "10.00", mode, { percentage: 50, startsOn: null, endsOn: null }),
                end: new Date(START.getTime() + 2.5 * MINUTES[mode] * 60_000),
                quantity,
                currency,
                tax,
                typedUnitPrice,
              };
              compared += 1;
              const [form, server] = [formTotal(input), serverTotal(input)];
              if (form.total !== server.total) {
                mismatches.push(`${typedUnitPrice} ${mode} ${kind} ×${quantity} ${currency}`);
              }
            }
  assert.equal(compared, 216);
  assert.deepEqual(mismatches, []);
});
