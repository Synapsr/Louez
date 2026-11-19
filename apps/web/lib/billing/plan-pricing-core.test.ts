import assert from "node:assert/strict";
import { test } from "node:test";

import { planPriceIds, planPricingFromStripe, type PlanStripePrice } from "./plan-pricing-core";

// A currency other than EUR and USD shows the amounts of its Stripe prices, and sells a
// plan only when Stripe bills each one as the plan page says
// (docs/billing/devise-abonnement.md).

const plans = [
  { slug: "free", price: 0 },
  {
    slug: "pro",
    price: 49,
    stripePrices: {
      eur: { monthly: "price_pro_month", yearly: "price_pro_year" },
      gbp: { monthly: "price_pro_month_gbp", yearly: "price_pro_year_gbp" },
    },
  },
  {
    slug: "ultra",
    price: 159,
    stripePrices: {
      eur: { monthly: "price_ultra_month", yearly: "price_ultra_year" },
      gbp: { monthly: "price_ultra_month_gbp", yearly: "price_ultra_year_gbp" },
    },
  },
];

const price = (
  id: string,
  unitAmount: number | null,
  overrides: Partial<PlanStripePrice> = {},
): PlanStripePrice => ({
  id,
  active: true,
  currency: "gbp",
  unitAmount,
  recurringInterval: id.includes("year") ? "year" : "month",
  ...overrides,
});

const gbpPrices = (...replaced: PlanStripePrice[]) =>
  new Map(
    [
      price("price_pro_month_gbp", 3900),
      price("price_pro_year_gbp", 39000),
      price("price_ultra_month_gbp", 12900),
      price("price_ultra_year_gbp", 129000),
      ...replaced,
    ].map((each) => [each.id, each]),
  );

test("the GBP amounts are its Stripe prices, in pounds", () => {
  assert.deepEqual(planPriceIds(plans, "gbp"), [
    "price_pro_month_gbp",
    "price_pro_year_gbp",
    "price_ultra_month_gbp",
    "price_ultra_year_gbp",
  ]);
  assert.deepEqual(planPricingFromStripe(plans, "gbp", gbpPrices()), {
    pricing: {
      currency: "gbp",
      amounts: { pro: { monthly: 39, yearly: 390 }, ultra: { monthly: 129, yearly: 1290 } },
    },
    problem: null,
  });
});

test("EUR and USD keep the code's amounts, without reading Stripe", () => {
  assert.deepEqual(planPricingFromStripe(plans, "eur", new Map()).pricing, {
    currency: "eur",
    amounts: { pro: { monthly: 49, yearly: 490 }, ultra: { monthly: 159, yearly: 1590 } },
  });
});

test("a price Stripe would bill otherwise than the page says keeps the currency from selling", () => {
  const cases: [PlanStripePrice | null, string][] = [
    [price("price_ultra_year_gbp", 129000, { currency: "eur" }), "currency"],
    [price("price_ultra_year_gbp", 12900, { recurringInterval: "month" }), "interval"],
    [price("price_ultra_year_gbp", null), "unit_amount"],
    [price("price_ultra_year_gbp", 129000, { active: false }), "active"],
  ];
  for (const [replaced, field] of cases) {
    const result = planPricingFromStripe(plans, "gbp", gbpPrices(...(replaced ? [replaced] : [])));
    assert.equal(result.pricing, null, field);
    assert.deepEqual(
      result.problem,
      { kind: "mismatch", priceId: "price_ultra_year_gbp", field },
      field,
    );
  }

  const missing = gbpPrices();
  missing.delete("price_pro_year_gbp");
  assert.deepEqual(planPricingFromStripe(plans, "gbp", missing).problem, {
    kind: "missing",
    priceId: "price_pro_year_gbp",
  });
  // No env price at all.
  assert.deepEqual(planPricingFromStripe(plans, "chf", new Map()).problem, {
    kind: "missing",
    priceId: "pro monthly",
  });
});
