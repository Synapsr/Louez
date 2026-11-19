import assert from "node:assert/strict";
import { test } from "node:test";

import { codePlanPricing, findPlanPrice, formatPlanPrice } from "./plans.shared";

// The webhook reads a subscription's plan from its price (plans-for-new-stores L10): the
// plan's own price, in every currency it bills, or one of its earlier ones.

const plans = [
  {
    slug: "pro",
    price: 49,
    stripePrices: { monthly: "price_pro_month", yearly: "price_pro_year" },
    legacyStripePrices: { usd: { monthly: "price_pro_month_usd" } },
  },
  { slug: "ultra", price: 159, stripePrices: { monthly: "price_ultra_month" } },
];

test("a plan's own price maps back to the plan and interval", () => {
  for (const plan of plans) {
    for (const interval of ["monthly", "yearly"] as const) {
      const priceId = plan.stripePrices[interval];
      if (!priceId) continue;
      assert.deepEqual(findPlanPrice(plans, priceId), { plan, interval }, priceId);
    }
  }
});

test("an earlier price still maps to its plan; a price no plan has, to nothing", () => {
  assert.deepEqual(findPlanPrice(plans, "price_pro_month_usd"), {
    plan: plans[0],
    interval: "monthly",
  });
  assert.equal(findPlanPrice(plans, "price_unknown"), null);
});

test("plan prices read 49€ and $49 as always, and the locale's format in another currency", () => {
  assert.equal(formatPlanPrice(49, "eur", "en"), "49€");
  assert.equal(formatPlanPrice(49, "usd", "fr"), "$49");
  assert.equal(formatPlanPrice(39, "gbp", "en"), "£39");
  assert.equal(formatPlanPrice(69, "cad", "en"), "CA$69");
  assert.equal(formatPlanPrice(45.5, "chf", "en"), "CHF 45.50");
  assert.equal(formatPlanPrice(10, "zzzz", "en"), "10 ZZZZ");
});

test("without Stripe, the plans sell in EUR at the code's amounts, ten months a year", () => {
  assert.deepEqual(codePlanPricing([...plans, { slug: "free", price: 0 }]), {
    currency: "eur",
    amounts: { pro: { monthly: 49, yearly: 490 }, ultra: { monthly: 159, yearly: 1590 } },
  });
});
