import assert from "node:assert/strict";
import { test } from "node:test";

import { findPlanPrice, getPlanPriceId } from "./plans.shared";

// The webhook reads a subscription's plan from its price (plans-for-new-stores L10).

const plans = [
  {
    slug: "pro",
    stripePriceMonthly: "price_pro_month_legacy",
    stripePrices: {
      eur: { monthly: "price_pro_month", yearly: "price_pro_year" },
      usd: { monthly: "price_pro_month_usd" },
    },
  },
  { slug: "ultra", stripePriceMonthly: "price_ultra_month", stripePriceYearly: "price_ultra_year" },
];

test("a price maps back to the plan, interval and currency getPlanPriceId gives it for", () => {
  for (const plan of plans) {
    for (const currency of ["eur", "usd"] as const) {
      for (const interval of ["monthly", "yearly"] as const) {
        const priceId = getPlanPriceId(plan, interval, currency);
        if (!priceId) continue;
        assert.deepEqual(findPlanPrice(plans, priceId), { plan, interval, currency }, priceId);
      }
    }
  }
  assert.equal(findPlanPrice(plans, "price_pro_month_usd")?.currency, "usd");
});

test("a price no plan has, or a legacy field the currency map hides, maps to nothing", () => {
  assert.equal(findPlanPrice(plans, "price_unknown"), null);
  assert.equal(findPlanPrice(plans, "price_pro_month_legacy"), null);
});
