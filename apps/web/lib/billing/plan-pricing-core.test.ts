import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPlanCatalog,
  fallbackPlanCatalog,
  planCurrencyFor,
  planPriceIds,
  type PlanStripePrice,
} from "./plan-pricing-core";

// The plans sell in every currency their Stripe prices have an amount in
// (`currency_options`), and in USD on the earlier USD prices while those lack it
// (docs/billing/devise-abonnement.md).

const plans = [
  { slug: "free", price: 0 },
  {
    slug: "pro",
    price: 49,
    stripePrices: { monthly: "pro_m", yearly: "pro_y" },
    legacyStripePrices: { usd: { monthly: "pro_m_usd", yearly: "pro_y_usd" } },
  },
  {
    slug: "ultra",
    price: 159,
    stripePrices: { monthly: "ultra_m", yearly: "ultra_y" },
    legacyStripePrices: { usd: { monthly: "ultra_m_usd", yearly: "ultra_y_usd" } },
  },
];

const price = (
  id: string,
  amounts: Record<string, number | null>,
  overrides: Partial<PlanStripePrice> = {},
): PlanStripePrice => ({
  id,
  active: true,
  currency: Object.keys(amounts)[0] ?? "eur",
  recurringInterval: id.includes("_y") ? "year" : "month",
  amounts,
  ...overrides,
});

const pricesOf = (...list: PlanStripePrice[]) => new Map(list.map((each) => [each.id, each]));

/** The plans' own prices, in EUR with a GBP amount, and Ultra yearly without CHF. */
const own = [
  price("pro_m", { eur: 4900, gbp: 3900, chf: 4500 }),
  price("pro_y", { eur: 49000, gbp: 39000, chf: 45000 }),
  price("ultra_m", { eur: 15900, gbp: 12900, chf: 14900 }),
  price("ultra_y", { eur: 159000, gbp: 129000 }),
];
const legacyUsd = [
  price("pro_m_usd", { usd: 4900 }),
  price("pro_y_usd", { usd: 49000 }),
  price("ultra_m_usd", { usd: 15900 }),
  price("ultra_y_usd", { usd: 159000 }),
];

test("every currency all four prices have an amount in sells, at those amounts", () => {
  const { catalog, problems } = buildPlanCatalog(plans, pricesOf(...own));
  assert.deepEqual(problems, []);
  assert.deepEqual([...catalog.keys()].sort(), ["eur", "gbp"]);
  assert.deepEqual(catalog.get("gbp"), {
    pricing: {
      currency: "gbp",
      amounts: { pro: { monthly: 39, yearly: 390 }, ultra: { monthly: 129, yearly: 1290 } },
    },
    priceIds: {
      pro: { monthly: "pro_m", yearly: "pro_y" },
      ultra: { monthly: "ultra_m", yearly: "ultra_y" },
    },
  });
  // CHF lacks Ultra yearly: the store pays in EUR.
  assert.equal(planCurrencyFor(catalog, "CHF"), "eur");
  assert.equal(planCurrencyFor(catalog, " GBP "), "gbp");
  assert.equal(planCurrencyFor(catalog, null), "eur");
});

test("USD sells on the earlier USD prices until the plans' own prices have a USD amount", () => {
  const before = buildPlanCatalog(plans, pricesOf(...own, ...legacyUsd)).catalog;
  assert.deepEqual(before.get("usd")?.priceIds.pro, { monthly: "pro_m_usd", yearly: "pro_y_usd" });
  assert.deepEqual(before.get("usd")?.pricing.amounts.ultra, { monthly: 159, yearly: 1590 });

  const withUsd = own.map((each) =>
    price(each.id, { ...each.amounts, usd: (each.amounts.eur ?? 0) + 100 }),
  );
  const after = buildPlanCatalog(plans, pricesOf(...withUsd, ...legacyUsd)).catalog;
  assert.deepEqual(after.get("usd")?.priceIds.pro, { monthly: "pro_m", yearly: "pro_y" });
  assert.deepEqual(after.get("usd")?.pricing.amounts.pro, { monthly: 50, yearly: 491 });
});

test("a missing, archived or misbilled price sells nothing, and says why", () => {
  const cases: [PlanStripePrice[], string][] = [
    [own.slice(0, 3), "ultra yearly: ultra_y not found"],
    [[...own.slice(0, 3), price("ultra_y", { eur: 159000 }, { active: false })], "ultra_y: archived"],
    [
      [...own.slice(0, 3), price("ultra_y", { eur: 159000 }, { recurringInterval: "month" })],
      "ultra_y: bills every month",
    ],
  ];
  for (const [list, problem] of cases) {
    const { catalog, problems } = buildPlanCatalog(plans, pricesOf(...list));
    assert.equal(catalog.size, 0, problem);
    assert.deepEqual(problems, [problem]);
  }
  // An amount Stripe computes (tiers) sells nothing in that currency.
  const tiered = buildPlanCatalog(
    plans,
    pricesOf(...own.slice(0, 3), price("ultra_y", { eur: 159000, gbp: null })),
  ).catalog;
  assert.deepEqual([...tiered.keys()], ["eur"]);
});

test("the ids read are the plans' own and earlier ones, paid plans only", () => {
  assert.deepEqual(planPriceIds(plans), [
    "pro_m",
    "pro_y",
    "pro_m_usd",
    "pro_y_usd",
    "ultra_m",
    "ultra_y",
    "ultra_m_usd",
    "ultra_y_usd",
  ]);
});

test("when Stripe cannot be read, EUR sells at the code's amounts on the plans' own prices", () => {
  const catalog = fallbackPlanCatalog(plans);
  assert.deepEqual([...catalog.keys()], ["eur"]);
  assert.deepEqual(catalog.get("eur")?.pricing.amounts.pro, { monthly: 49, yearly: 490 });
  assert.deepEqual(catalog.get("eur")?.priceIds.ultra, { monthly: "ultra_m", yearly: "ultra_y" });
});
