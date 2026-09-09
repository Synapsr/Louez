import assert from "node:assert/strict";
import { test } from "node:test";

import type { TaxSettings } from "@louez/types";

import {
  buildStripeLineItems,
  getCheckoutChargeAmount,
  sumStripeLineItems,
} from "./build-stripe-line-items";
import {
  computeReservationTotals,
  DELIVERY_TAX_LINE_ID,
  getItemTaxLineId,
  INSURANCE_TAX_LINE_ID,
  type PricedCartLine,
  type ReservationTotals,
} from "./price-cart";

// EUR: two decimals, like `toStripeCents(amount, "EUR")`.
const toCents = (amount: number): number => Math.round(amount * 100);

const line = (overrides: Partial<PricedCartLine> & { productId: string }): PricedCartLine => ({
  productName: `Product ${overrides.productId}`,
  quantity: 1,
  pricingKind: "duration",
  duration: 2,
  unitPrice: 50,
  depositPerUnit: 0,
  subtotal: 100,
  originalSubtotal: 100,
  savings: 0,
  totalDeposit: 0,
  taxSettings: null,
  ...overrides,
});

const lines = [
  line({ productId: "a", quantity: 1, unitPrice: 100, subtotal: 100, originalSubtotal: 100 }),
  line({ productId: "b", quantity: 2, unitPrice: 25, subtotal: 50, originalSubtotal: 50 }),
];

const ttc: TaxSettings = { enabled: true, defaultRate: 20, displayMode: "inclusive" };
const ht: TaxSettings = { enabled: true, defaultRate: 20, displayMode: "exclusive" };

const INSURANCE = 12.34;
const DELIVERY = 15;

const totalsFor = (
  taxSettings: TaxSettings | undefined,
  discountAmount: number,
): ReservationTotals =>
  computeReservationTotals({
    lines,
    insuranceAmount: INSURANCE,
    discountAmount,
    deliveryFee: DELIVERY,
    totalDeposit: 300,
    taxSettings,
  });

const buildFor = (
  totals: ReservationTotals,
  depositPercentage: number,
): { items: ReturnType<typeof buildStripeLineItems>; finalChargeAmount: number } => {
  const charge = getCheckoutChargeAmount({ total: totals.total, depositPercentage });
  const items = buildStripeLineItems({
    reservationNumber: "R2607-0001",
    isPartialPayment: charge.isPartialPayment,
    depositPercentage,
    finalChargeAmount: charge.finalChargeAmount,
    displayMode: totals.displayMode,
    discountAmount: totals.discount,
    items: lines.map((cartLine, index) => ({
      name: cartLine.productName,
      quantity: cartLine.quantity,
      subtotal: cartLine.subtotal,
      taxLine: totals.taxByLineId.get(getItemTaxLineId(index)),
    })),
    insuranceAmount: INSURANCE,
    insuranceTaxLine: totals.taxByLineId.get(INSURANCE_TAX_LINE_ID),
    deliveryFee: DELIVERY,
    deliveryTaxLine: totals.taxByLineId.get(DELIVERY_TAX_LINE_ID),
    toCents,
  });
  return { items, finalChargeAmount: charge.finalChargeAmount };
};

test("partial payment: a single deposit line equal to the charged amount", () => {
  const totals = totalsFor(ttc, 0);
  const { items, finalChargeAmount } = buildFor(totals, 30);

  assert.equal(items.length, 1);
  assert.equal(items[0].name, "Acompte (30%)");
  assert.equal(items[0].description, "Acompte pour la réservation R2607-0001");
  assert.equal(sumStripeLineItems(items), toCents(finalChargeAmount));
  assert.equal(finalChargeAmount, Math.round(totals.total * 30) / 100);
});

test("full payment, TTC display, no promo: lines sum to the charged total", () => {
  const totals = totalsFor(ttc, 0);
  const { items, finalChargeAmount } = buildFor(totals, 100);

  assert.deepEqual(
    items.map((item) => item.name),
    ["Product a", "Product b", "Garantie casse/vol", "Livraison"],
  );
  assert.equal(items[1].quantity, 2);
  assert.equal(items[1].unitAmount, toCents(25));
  assert.equal(sumStripeLineItems(items), toCents(finalChargeAmount));
  assert.equal(finalChargeAmount, totals.total);
});

test("full payment, no tax, no promo: lines sum to the charged total", () => {
  const totals = totalsFor(undefined, 0);
  const { items, finalChargeAmount } = buildFor(totals, 100);

  assert.equal(sumStripeLineItems(items), toCents(finalChargeAmount));
});

test("full payment, HT display with a promo: tax-engine lines (net of discount) sum to the charged total", () => {
  const totals = totalsFor(ht, 10);
  const { items, finalChargeAmount } = buildFor(totals, 100);

  // One line per tax-engine line, each with quantity 1 and the tax-inclusive amount.
  assert.deepEqual(
    items.map((item) => [item.name, item.quantity]),
    [
      ["Product a", 1],
      ["Product b", 1],
      ["Garantie casse/vol", 1],
      ["Livraison", 1],
    ],
  );
  assert.equal(items[1].description, "2 × Product b");
  assert.equal(sumStripeLineItems(items), toCents(finalChargeAmount));
  assert.equal(finalChargeAmount, totals.total);
});

test("HT display: zero-amount lines are skipped", () => {
  const totals = computeReservationTotals({
    lines,
    insuranceAmount: 0,
    discountAmount: 0,
    deliveryFee: 0,
    totalDeposit: 0,
    taxSettings: ht,
  });
  const { items, finalChargeAmount } = buildFor(
    { ...totals, taxByLineId: totals.taxByLineId },
    100,
  );

  // The builder received INSURANCE/DELIVERY amounts but no tax lines for them.
  assert.deepEqual(
    items.map((item) => item.name),
    ["Product a", "Product b"],
  );
  assert.equal(sumStripeLineItems(items), toCents(finalChargeAmount));
});

test("full payment, TTC display with a promo: net tax-engine lines sum to the charged total", () => {
  const discount = 10;
  const totals = totalsFor(ttc, discount);
  const { items, finalChargeAmount } = buildFor(totals, 100);

  // The promo is allocated per line by the tax engine; Stripe must charge the
  // reservation total (net), which is also the pending payment row amount.
  assert.equal(finalChargeAmount, totals.total);
  assert.equal(sumStripeLineItems(items), toCents(finalChargeAmount));
  assert.deepEqual(
    items.map((item) => [item.name, item.quantity]),
    [
      ["Product a", 1],
      ["Product b", 1],
      ["Garantie casse/vol", 1],
      ["Livraison", 1],
    ],
  );
  assert.equal(items[1].description, "2 × Product b");
});

test("full payment, no tax, with a promo: lines sum to the charged total", () => {
  const totals = totalsFor(undefined, 7.5);
  const { items, finalChargeAmount } = buildFor(totals, 100);

  assert.equal(finalChargeAmount, totals.total);
  assert.equal(sumStripeLineItems(items), toCents(finalChargeAmount));
});

test("getCheckoutChargeAmount floors at Stripe's minimum and never exceeds the total", () => {
  assert.deepEqual(getCheckoutChargeAmount({ total: 125, depositPercentage: 100 }), {
    isPartialPayment: false,
    finalChargeAmount: 125,
  });
  assert.deepEqual(getCheckoutChargeAmount({ total: 125, depositPercentage: 30 }), {
    isPartialPayment: true,
    finalChargeAmount: 37.5,
  });
  // 1% of 10 = 0.10 → floored to 0.50.
  assert.deepEqual(getCheckoutChargeAmount({ total: 10, depositPercentage: 1 }), {
    isPartialPayment: true,
    finalChargeAmount: 0.5,
  });
  // The floor never pushes the charge above a tiny total.
  assert.deepEqual(getCheckoutChargeAmount({ total: 0.3, depositPercentage: 50 }), {
    isPartialPayment: true,
    finalChargeAmount: 0.3,
  });
});
