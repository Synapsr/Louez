import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PLAN_CURRENCIES,
  codePlanPricing,
  findPlanPrice,
  formatPlanPrice,
  getPlanPriceId,
  hasPlanPrices,
  isPlanCurrency,
  planCurrencyFor,
} from "./plans.shared";

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

// A store is billed in its own currency once its plans have prices in it, in EUR until
// then (docs/billing/devise-abonnement.md).

const grid = [
  {
    slug: "pro",
    price: 49,
    stripePrices: {
      eur: { monthly: "price_pro_month", yearly: "price_pro_year" },
      usd: { monthly: "price_pro_month_usd", yearly: "price_pro_year_usd" },
      gbp: { monthly: "price_pro_month_gbp", yearly: "price_pro_year_gbp" },
      chf: { monthly: "price_pro_month_chf", yearly: "price_pro_year_chf" },
    },
  },
  {
    slug: "ultra",
    price: 159,
    stripePrices: {
      eur: { monthly: "price_ultra_month", yearly: "price_ultra_year" },
      usd: { monthly: "price_ultra_month_usd", yearly: "price_ultra_year_usd" },
      gbp: { monthly: "price_ultra_month_gbp", yearly: "price_ultra_year_gbp" },
      // CHF lacks Ultra yearly: not enough to sell in CHF.
      chf: { monthly: "price_ultra_month_chf" },
    },
  },
];

test("a store gets its own currency when every paid plan has both its prices in it", () => {
  assert.equal(planCurrencyFor(grid, "EUR"), "eur");
  assert.equal(planCurrencyFor(grid, "usd"), "usd");
  assert.equal(planCurrencyFor(grid, " GBP "), "gbp");
  assert.equal(hasPlanPrices(grid, "gbp"), true);
});

test("a store whose currency lacks a price, or is no plan currency, gets EUR as before", () => {
  assert.equal(hasPlanPrices(grid, "chf"), false);
  assert.equal(planCurrencyFor(grid, "CHF"), "eur");
  assert.equal(planCurrencyFor(grid, "CAD"), "eur");
  assert.equal(planCurrencyFor(grid, "JPY"), "eur");
  assert.equal(planCurrencyFor(grid, ""), "eur");
  assert.equal(planCurrencyFor(grid, null), "eur");
  assert.equal(planCurrencyFor(grid, undefined), "eur");
});

test("without env prices for another currency, the plans read the EUR and USD ones only", () => {
  const unconfigured = grid.map((plan) => ({
    ...plan,
    stripePrices: {
      eur: plan.stripePrices.eur,
      usd: plan.stripePrices.usd,
      gbp: { monthly: undefined, yearly: undefined },
    },
  }));
  assert.equal(planCurrencyFor(unconfigured, "GBP"), "eur");
  assert.equal(findPlanPrice(unconfigured, "price_pro_month_gbp"), null);
  assert.equal(findPlanPrice(grid, "price_pro_year_gbp")?.currency, "gbp");
  assert.ok(PLAN_CURRENCIES.every((currency) => isPlanCurrency(currency)));
  assert.equal(isPlanCurrency("jpy"), false);
});

test("plan prices read 49€ and $49 as always, and the locale's format in another currency", () => {
  assert.equal(formatPlanPrice(49, "eur", "en"), "49€");
  assert.equal(formatPlanPrice(49, "usd", "fr"), "$49");
  assert.equal(formatPlanPrice(39, "gbp", "en"), "£39");
  assert.equal(formatPlanPrice(69, "cad", "en"), "CA$69");
  assert.equal(formatPlanPrice(45.5, "chf", "en"), "CHF\u00a045.50");
});

test("the code's amounts are a plan's price and ten months a year, paid plans only", () => {
  const pricing = codePlanPricing([...grid, { slug: "free", price: 0 }], "usd");
  assert.deepEqual(pricing, {
    currency: "usd",
    amounts: { pro: { monthly: 49, yearly: 490 }, ultra: { monthly: 159, yearly: 1590 } },
  });
});
